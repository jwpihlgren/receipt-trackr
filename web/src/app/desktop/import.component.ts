import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MenyComponent } from '../shared/meny.component';
import { TolkningService } from '../ocr/tolkning.service';
import { ulid } from '../shared/ulid';

type Rad = {
  namn: string;
  status: 'väntar' | 'skickar' | 'arkiverad' | 'tolkar' | 'klar' | 'fel';
  id?: string;
  fel?: string;
  /** Vad tolkningen fick ut. Tomt tills bilden lästs. */
  butik?: string | null;
  belopp?: number | null;
};

/**
 * Import från datorn: en hög bilder in i arkivet.
 *
 * Fångsten bor på telefonen, och det är rätt för ett kvitto man just fått i handen.
 * Men en hög som redan ligger i en mapp — inskannad, nedladdad, eller fotograferad
 * med något annat — har ingen väg in, och att fota om en skärm vore att kopiera bort
 * kvaliteten.
 *
 * **En bild är ett kvitto här.** Ett långt kvitto i flera bilder blir ett kvitto per
 * bild vid importen, och de slås ihop av matchningen om de visar samma köp; går det
 * inte finns *Lägg till bild* på kvittot. Att gissa vilka filer som hör ihop av
 * ordningen i en mapp vore just den sortens gissning som senare måste ångras.
 *
 * Filerna skickas en i taget. Servern kvitterar varje bild med sitt sha256 innan
 * nästa börjar, och en avbruten import lämnar det som hunnit fram i arkivet — inget
 * halvt kvitto, inga tappade bilder.
 *
 * **Bilderna läses direkt efteråt, utan att någon ber om det.** Regeln att datorn
 * bara arbetar när någon säger till gäller fortfarande — men den som valt trettio
 * filer och tryckt Importera *har* sagt till. Att kräva ett andra tryck vore att låta
 * en regel om obedd bakgrundskörning gälla ett arbete man just beställt. Först
 * arkiveras allt, sedan läses det: bilden är oåterkallelig, texten är det inte.
 */
@Component({
  selector: 'app-import',
  imports: [RouterLink, MenyComponent],
  templateUrl: './import.component.html',
})
export class ImportComponent {
  private readonly router = inject(Router);
  readonly tolkning = inject(TolkningService);

  readonly rader = signal<Rad[]>([]);
  readonly kor = signal(false);
  private stoppad = false;

  readonly arkiverade = computed(
    () => this.rader().filter((r) => r.status !== 'väntar' && r.status !== 'skickar' && r.status !== 'fel').length,
  );
  readonly klara = computed(() => this.rader().filter((r) => r.status === 'klar').length);
  readonly fel = computed(() => this.rader().filter((r) => r.status === 'fel').length);
  readonly kvar = computed(() => this.rader().filter((r) => r.status === 'väntar' || r.status === 'skickar').length);

  private filer: File[] = [];

  valj(event: Event): void {
    const valda = [...((event.target as HTMLInputElement).files ?? [])];
    (event.target as HTMLInputElement).value = '';
    this.lagg(valda);
  }

  slapp(event: DragEvent): void {
    event.preventDefault();
    this.lagg([...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/')));
  }

  over(event: DragEvent): void {
    event.preventDefault();
  }

  /** Filnamnsordning, för en hög från en kamera ligger i tidsordning i mappen. */
  private lagg(valda: File[]): void {
    if (valda.length === 0) return;
    this.filer = [...this.filer, ...valda].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    this.rader.set(this.filer.map((f) => ({ namn: f.name, status: 'väntar' })));
  }

  rensa(): void {
    if (this.kor()) return;
    this.filer = [];
    this.rader.set([]);
  }

  /**
   * Skickar en fil i taget: skapa kvittot med klientens ULID, lägg bilden på det, och
   * säg att fångsten är hel. Samma tre steg som telefonen tar, och samma idempotens —
   * ett omtaget anrop träffar samma kvitto i stället för att skapa ett andra.
   */
  async importera(): Promise<void> {
    if (this.kor() || this.filer.length === 0) return;
    this.stoppad = false;
    this.kor.set(true);
    try {
      for (const [i, fil] of this.filer.entries()) {
        // *Sluta* står framme under hela arbetet och måste betyda något i båda halvorna.
        // Stannar man under uppladdningen ligger det som hunnit fram kvar i arkivet, och
        // resten står som "Väntar" tills man trycker Importera igen.
        if (this.stoppad) break;
        // Det som redan ligger i arkivet skickas inte om vid ett omtag.
        if (this.rader()[i]?.id) continue;
        this.satt(i, { status: 'skickar' });
        try {
          const id = ulid();
          await this.skicka('/api/receipts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, backlog: true }),
          });

          const kropp = new FormData();
          kropp.append('file', fil);
          await this.skicka(`/api/receipts/${id}/segments/1`, { method: 'POST', body: kropp });

          await this.skicka(`/api/receipts/${id}/complete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ segments: 1 }),
          });
          this.satt(i, { status: 'arkiverad', id });
        } catch (orsak) {
          this.satt(i, { status: 'fel', fel: (orsak as Error).message });
        }
      }

      await this.las();
    } finally {
      this.kor.set(false);
    }
  }

  /**
   * Läsningen körs av **tjänsten**, inte av den här sidan.
   *
   * Det är skillnaden mellan ett arbete som pågår och ett som avbryts när man byter
   * skärm: tjänsten lever i roten, aktiviteten visar samma framdrift, och den som
   * lämnar importen mitt i får sina kvitton lästa ändå. Sidan lyssnar bara — och när
   * ett kvitto blivit klart hämtar den vad som lästes, så att raden visar butiken och
   * beloppet i stället för ett grönt hak.
   */
  private async las(): Promise<void> {
    if (this.stoppad) return;
    await this.tolkning.kor();
  }

  /** Stannar läsningen efter det kvitto som pågår. Uppladdade bilder står kvar. */
  stanna(): void {
    this.stoppad = true;
    this.tolkning.stanna();
  }

  /**
   * Andel uppladdat, för cirkeln.
   *
   * Filer som inte gick fram räknas bort ur nämnaren. De står redan i sammanfattningen
   * med sitt eget tal, och en ring som aldrig kan fyllas för att en av trettio filer
   * strulade ser ut som ett arbete som hängt sig.
   */
  readonly andelUppladdat = computed(() => {
    const forsokta = this.rader().length - this.fel();
    return forsokta <= 0 ? 0 : Math.round((this.arkiverade() / forsokta) * 100);
  });

  /** Kvittot tjänsten läste förra gången effekten sprang. */
  private foregaende: string | null = null;

  constructor() {
    /**
     * Sidan följer tjänsten genom att titta på vilket kvitto som är aktuellt. När det
     * byts är det föregående färdigt, och bara det hämtas hem — inte hela listan varje
     * gång, vilket för trettio filer vore trettio omgångar av trettio anrop.
     *
     * Effekten skriver till `rader`, som den själv skulle läsa om avläsningen låg i
     * spårat läge: en effekt som väcker sig själv. Därför `untracked` — det den ska
     * vakna av är tjänstens tillstånd, ingenting annat.
     */
    effect(() => {
      const aktuellt = this.tolkning.aktuellt();
      this.tolkning.klaraTotalt();
      untracked(() => void this.foljMed(aktuellt));
    });
  }

  private async foljMed(aktuellt: string | null): Promise<void> {
    const klart = this.foregaende;
    this.foregaende = aktuellt;

    if (aktuellt) {
      const i = this.rader().findIndex((r) => r.id === aktuellt);
      if (i >= 0) this.satt(i, { status: 'tolkar' });
    }
    if (klart && klart !== aktuellt) await this.hamtaResultat(klart);
  }

  /**
   * Hämtar hem vad tolkningen fick ut ur ett kvitto, så att raden kan visa butiken och
   * beloppet i stället för ett grönt hak. Utan text blev bilden inte läst; raden står
   * kvar som den var, och aktiviteten är stället där det reds ut.
   */
  private async hamtaResultat(id: string): Promise<void> {
    const i = this.rader().findIndex((r) => r.id === id);
    if (i < 0) return;
    try {
      const svar = await fetch(`/api/receipts/${id}`);
      if (!svar.ok) return;
      const kvitto = (await svar.json()) as {
        text?: string;
        fields?: { store?: { value: string }; total?: { value: number } };
      };
      if (!kvitto.text?.trim()) return void this.satt(i, { status: 'arkiverad' });
      this.satt(i, {
        status: 'klar',
        butik: kvitto.fields?.store?.value ?? null,
        belopp: kvitto.fields?.total?.value ?? null,
      });
    } catch {
      // Nätet svarade inte just nu. Raden står kvar som den var.
    }
  }

  private satt(index: number, delar: Partial<Rad>): void {
    this.rader.update((rader) => rader.map((rad, i) => (i === index ? { ...rad, ...delar } : rad)));
  }

  private async skicka(url: string, init: RequestInit): Promise<Response> {
    const svar = await fetch(url, init);
    if (svar.status === 401) {
      await this.router.navigateByUrl('/logga-in');
      throw new Error('Utloggad');
    }
    if (!svar.ok) throw new Error(`Servern svarade ${svar.status}`);
    return svar;
  }
}
