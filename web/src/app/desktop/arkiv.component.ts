import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TolkningService } from '../ocr/tolkning.service';
import { MenyComponent } from '../shared/meny.component';

type Rad = {
  id: string;
  date: string | null;
  store: string | null;
  total: number | null;
  currency: string | null;
  capturedAt: string;
  segments: number;
  snippet: string | null;
};

type Svar = { total: number; receipts: Rad[]; butiker: string[] };

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

  /** Kvittens för radering, som sker på en annan sida. Slocknar av sig själv. */
  readonly raderat = signal(false);
  readonly tolkning = inject(TolkningService);

  readonly rader = signal<Rad[] | null>(null);
  readonly total = signal(0);
  readonly butiker = signal<string[]>([]);
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

  readonly fraga = signal('');
  readonly butik = signal('');
  readonly fran = signal('');
  readonly till = signal('');

  /** Hur många kvitton som inte är klara. Siffran leder vidare, tabellen bor där. */
  readonly ofardiga = signal(0);

  readonly filtrerat = computed(() => !!(this.fraga() || this.butik() || this.fran() || this.till()));

  constructor() {
    if (this.route.snapshot.queryParamMap.has('raderat')) {
      this.raderat.set(true);
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
      setTimeout(() => this.raderat.set(false), 4000);
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
    if (this.fran()) p.set('fran', this.fran());
    if (this.till()) p.set('till', this.till());
    try {
      const svar = await fetch(`/api/receipts?${p.toString()}`);
      if (min !== this.lasning) return;
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      const body = (await svar.json()) as Svar;
      if (min !== this.lasning) return;
      this.rader.set(body.receipts);
      this.total.set(body.total);
      this.butiker.set(body.butiker);
      await this.raknaOfardiga(min);
    } catch {
      if (min !== this.lasning) return;
      this.error.set('Kvittona gick inte att hämta. Försök igen.');
    } finally {
      // Bara den hämtning som fortfarande gäller får släcka laddläget. Annars kunde
      // ett gammalt anrop som kom tillbaka sist påstå att det nya var färdigt.
      if (min === this.lasning) this.laddar.set(false);
    }
  }

  private async raknaOfardiga(min: number): Promise<void> {
    const svar = await fetch('/api/aktivitet');
    if (!svar.ok || min !== this.lasning) return;
    this.ofardiga.set(((await svar.json()) as { receipts: unknown[] }).receipts.length);
  }

  onFraga(event: Event): void {
    this.fraga.set((event.target as HTMLInputElement).value);
  }

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
    this.fran.set('');
    this.till.set('');
    void this.load();
  }

  tolka(): Promise<void> {
    return this.tolkning.kor();
  }

  belopp(rad: Rad): string {
    return rad.total === null ? '—' : rad.total.toFixed(2).replace('.', ',');
  }

  fangat(iso: string): string {
    return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
