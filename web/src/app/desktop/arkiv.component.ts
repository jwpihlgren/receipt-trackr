import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TolkningService } from '../ocr/tolkning.service';
import { MenyComponent } from '../shared/meny.component';
import { datum } from '../shared/datum';

type Rad = {
  id: string;
  date: string | null;
  store: string | null;
  total: number | null;
  currency: string | null;
  capturedAt: string;
  segments: number;
  snippet: string | null;
  kategori: string | null;
  /** Gruppen kvittot står i, eller `null`. Flera bilder på en rad är ett köp, inte flera. */
  grupp: string | null;
  medlemmar: number;
};

type Svar = { total: number; summa: number; receipts: Rad[]; butiker: string[]; kategorier: string[] };

/** Kolumnerna som går att sortera på. Samma fem namn som servern känner igen. */
export type Kolumn = 'date' | 'store' | 'total' | 'segments' | 'capturedAt';

/** Text sorteras stigande först, tal och datum fallande: största och senaste överst. */
const FORSTA_RIKTNINGEN: Record<Kolumn, boolean> = {
  date: false,
  store: true,
  total: false,
  segments: false,
  capturedAt: false,
};

/**
 * Arkivet: klara kvitton i en tabell, sorterade på kvittots eget datum.
 *
 * Det var tidigare en lista grupperad på fångstdag, vilket är fel datum att ordna ett
 * kvittoarkiv efter — man minns när man handlade, inte när man råkade fotografera.
 * Ofärdiga kvitton står inte här utan i aktiviteten.
 */
@Component({
  selector: 'app-arkiv',
  imports: [RouterLink, MenyComponent],
  templateUrl: './arkiv.component.html',
})
export class ArkivComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * Hur många kvitton som just togs bort. Noll betyder ingen kvittens att visa.
   *
   * Den var ett ja/nej och sattes av en flagga i adressen, från raderingen på
   * kvittosidan. Nu raderas det också härifrån, flera åt gången, och då är antalet
   * det som säger vad som hände.
   */
  readonly raderat = signal(0);
  readonly tolkning = inject(TolkningService);

  readonly rader = signal<Rad[] | null>(null);
  readonly total = signal(0);
  /** Summan för hela träffmängden, räknad i servern — inte för de rader som syns. */
  readonly summa = signal(0);
  readonly butiker = signal<string[]>([]);
  readonly kategorier = signal<string[]>([]);
  readonly kategori = signal('');
  readonly error = signal<string | null>(null);
  /** Sant medan en hämtning pågår. Skilt från `rader() === null`, som betyder "vet inte". */
  readonly laddar = signal(false);

  /**
   * Vilken hämtning som gäller.
   *
   * Filtren hämtar om vid varje ändring, och två anrop som överlappar kan komma
   * tillbaka i omvänd ordning — då avgjorde svarsordningen vad tabellen visade, inte
   * vad som stod i fälten. Byt butik och datum snabbt efter varandra, så visades
   * butikssvaret. Bara den senast startade hämtningen får skriva.
   */
  private lasning = 0;

  /**
   * Sorteringen. Kolumnen är ett av fem kända namn, aldrig en sträng som går vidare
   * till en fråga, och den skickas till servern i stället för att vändas i webbläsaren
   * — annars hade en sortering på belopp bara ordnat de tvåhundra rader som råkade
   * hämtas, och kallat det arkivets största köp.
   */
  readonly sortera = signal<Kolumn>('date');
  readonly stigande = signal(false);

  /**
   * Markerade kvitton, och rutan som står mellan dem och raderingen.
   *
   * Att radera är det enda i arkivet som inte går att ta tillbaka. Grinden är därför
   * ett ord man skriver — inte en knapp till att trycka på — och servern prövar
   * samma ord: ett formulär är ingen spärr, det är en artighet.
   */
  readonly valda = signal(new Set<string>());
  readonly bekraftelse = signal('');
  readonly raderar = signal(false);
  private readonly rutan = viewChild<ElementRef<HTMLDialogElement>>('raderaRuta');

  readonly fraga = signal('');
  readonly butik = signal('');
  readonly fran = signal('');
  readonly till = signal('');

  /** Hur många kvitton som inte är klara. Siffran leder vidare, tabellen bor där. */
  readonly filtrerat = computed(
    () => !!(this.fraga() || this.butik() || this.kategori() || this.fran() || this.till()),
  );

  constructor() {
    // Kategorin kan komma i adressen: analysen länkar hit med den man klickat på.
    const franAnalysen = this.route.snapshot.queryParamMap.get('kategori');
    if (franAnalysen) this.kategori.set(franAnalysen);

    if (this.route.snapshot.queryParamMap.has('raderat')) {
      this.raderat.set(1);
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
      setTimeout(() => this.raderat.set(0), 4000);
    }

    void this.load();
    void this.tolkning.rakna();

    // Ett tolkat kvitto kan bli klart och ska då dyka upp här. Första körningen
    // hoppas över: en effect kör en gång när den skapas, och utan det hämtade varje
    // sidladdning allt två gånger.
    let forsta = true;
    effect(() => {
      this.tolkning.klaraTotalt();
      if (forsta) {
        forsta = false;
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    const min = ++this.lasning;
    this.error.set(null);
    this.laddar.set(true);
    const p = new URLSearchParams();
    if (this.fraga().trim()) p.set('q', this.fraga().trim());
    if (this.butik()) p.set('butik', this.butik());
    if (this.kategori()) p.set('kategori', this.kategori());
    if (this.fran()) p.set('fran', this.fran());
    if (this.till()) p.set('till', this.till());
    p.set('sortera', this.sortera());
    p.set('ordning', this.stigande() ? 'asc' : 'desc');
    try {
      const svar = await fetch(`/api/receipts?${p.toString()}`);
      if (min !== this.lasning) return;
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      const body = (await svar.json()) as Svar;
      if (min !== this.lasning) return;
      this.rader.set(body.receipts);
      this.total.set(body.total);
      this.summa.set(body.summa);
      this.butiker.set(body.butiker);
      this.kategorier.set(body.kategorier);
    } catch {
      if (min !== this.lasning) return;
      this.error.set('Kvittona gick inte att hämta. Försök igen.');
    } finally {
      // Bara den hämtning som fortfarande gäller får släcka laddläget. Annars kunde
      // ett gammalt anrop som kom tillbaka sist påstå att det nya var färdigt.
      if (min === this.lasning) this.laddar.set(false);
    }
  }


  /** Klick i en rubrik: samma kolumn vänder ordningen, en ny börjar i sin egen. */
  sorteraPa(kolumn: Kolumn): void {
    if (this.sortera() === kolumn) this.stigande.update((s) => !s);
    else {
      this.sortera.set(kolumn);
      this.stigande.set(FORSTA_RIKTNINGEN[kolumn]);
    }
    void this.load();
  }

  readonly allaValda = computed(() => {
    const rader = this.rader() ?? [];
    return rader.length > 0 && rader.every((r) => this.valda().has(r.id));
  });
  readonly nagraValda = computed(() => this.valda().size > 0 && !this.allaValda());

  vaxla(id: string): void {
    this.valda.update((valda) => {
      const ny = new Set(valda);
      if (!ny.delete(id)) ny.add(id);
      return ny;
    });
  }

  valjAlla(event: Event): void {
    const pa = (event.target as HTMLInputElement).checked;
    this.valda.set(pa ? new Set((this.rader() ?? []).map((r) => r.id)) : new Set());
  }

  avmarkera(): void {
    this.valda.set(new Set());
  }

  fragaRadera(): void {
    this.bekraftelse.set('');
    this.rutan()?.nativeElement.showModal();
  }

  avbrytRadera(): void {
    this.rutan()?.nativeElement.close();
  }

  onBekraftelse(event: Event): void {
    this.bekraftelse.set((event.target as HTMLInputElement).value);
  }

  /** Ordet måste stämma här också — men det är serverns prövning som är spärren. */
  readonly farRadera = computed(() => this.bekraftelse().trim().toLowerCase() === 'radera');

  /**
   * Hur många kvitton de valda köpen består av. En rad är ett köp, och ett köp kan
   * vara tre foton — det ska stå i rutan, inte upptäckas efteråt.
   */
  readonly valdaKvitton = computed(() =>
    (this.rader() ?? []).filter((r) => this.valda().has(r.id)).reduce((n, r) => n + Math.max(1, r.medlemmar), 0),
  );

  async radera(): Promise<void> {
    if (!this.farRadera()) return;
    this.raderar.set(true);
    try {
      const svar = await fetch('/api/receipts/radera', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [...this.valda()], bekraftelse: this.bekraftelse() }),
      });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      const { borttagna } = (await svar.json()) as { borttagna: number };
      this.rutan()?.nativeElement.close();
      this.avmarkera();
      this.raderat.set(borttagna);
      setTimeout(() => this.raderat.set(0), 4000);
      await this.load();
    } catch {
      this.error.set('Kvittona gick inte att ta bort.');
    } finally {
      this.raderar.set(false);
    }
  }

  onFraga(event: Event): void {
    this.fraga.set((event.target as HTMLInputElement).value);
  }

  valjKategori(event: Event): void {
    this.kategori.set((event.target as HTMLSelectElement).value);
    void this.load();
  }

  /** Färgen följer kategorins plats i arkivets ordning, aldrig dess storlek. */
  farg(kategori: string | null): string {
    if (!kategori) return 'var(--kategori-ovrig)';
    const plats = this.kategorier().indexOf(kategori);
    return plats < 0 || kategori === 'Övrigt' ? 'var(--kategori-ovrig)' : `var(--kategori-${(plats % 6) + 1})`;
  }

  readonly summaText = computed(() =>
    this.summa().toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );

  valjButik(event: Event): void {
    this.butik.set((event.target as HTMLSelectElement).value);
    void this.load();
  }

  onFran(event: Event): void {
    this.fran.set((event.target as HTMLInputElement).value);
    void this.load();
  }

  onTill(event: Event): void {
    this.till.set((event.target as HTMLInputElement).value);
    void this.load();
  }

  sok(event: Event): void {
    event.preventDefault();
    void this.load();
  }

  rensa(): void {
    this.fraga.set('');
    this.butik.set('');
    this.kategori.set('');
    this.fran.set('');
    this.till.set('');
    void this.load();
  }

  tolka(): Promise<void> {
    return this.tolkning.kor();
  }

  /**
   * Belopp skrivs som svenska tal, med mellanrum mellan tusentalen. Raderna skrev
   * `9425,00` medan summaraden skrev `9 973,30` — samma kolumn, två sätt att läsa
   * en siffra, och det är sådant som gör att man kontrollräknar i onödan.
   */
  belopp(rad: Rad): string {
    return rad.total === null
      ? '—'
      : rad.total.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  readonly fangat = datum;
}
