import { Component, ElementRef, computed, inject, signal, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

type Rad = {
  id: string;
  capturedAt: string;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  /** Hur många av butik, datum och belopp som ingen människa sett. Serverns räkning. */
  unreviewed: number;
};

type Falt = {
  value: string | number;
  confidence: number;
  source: 'ocr' | 'manual' | 'confirmed';
  candidates?: { value: string | number; confidence: number }[];
};

type Segment = { file: string; sha256: string };

type Receipt = {
  id: string;
  capturedAt: string;
  segments: Segment[];
  fields: Record<string, Falt | undefined>;
  text: string;
};

/** Fälten i den ordning de läses på ett kvitto, och i den ordning tabbkedjan går. */
const FALT = [
  { namn: 'store', etikett: 'BUTIK', sort: 'text' },
  { namn: 'date', etikett: 'DATUM', sort: 'text' },
  { namn: 'total', etikett: 'BELOPP', sort: 'tal' },
] as const;

type Namn = (typeof FALT)[number]['namn'];
type Rattelse = { namn: Namn; value: string | number; bekraftat: boolean };

/** Alla tre nycklarna finns alltid. Ett utkast som saknas är ett tomt fält, inte ett hål. */
const tomtUtkast = (): Record<string, string> => Object.fromEntries(FALT.map((f) => [f.namn, '']));

/**
 * Rättningspasset: ett läge man går in i med avsikt och betar av.
 *
 * Kvittovyn kan redan rätta ett fält, men bara ett i taget och bara för det kvitto man
 * råkar titta på. Det som saknades var vägen genom högen — och den är inte en skärm
 * till utan en tangentbordsslinga: `Enter` sparar fältet och faller till nästa, och
 * `Enter` i det sista fältet sparar och tar in nästa kvitto. Handen lämnar aldrig
 * tangentbordet, och blicken lämnar aldrig bilden.
 *
 * Arbetslistan hämtas **en gång**, när passet börjar. Den är en lista över det som
 * fanns då, inte en levande kö: kommer ett nytt kvitto in medan man håller på ska
 * ordningen inte kastas om under fingrarna, och antalet i rubriken ska betyda något.
 *
 * Ett fält som lämnas orört när man går vidare sparas inte. Att tolka tystnad som
 * "stämmer" vore att fabricera granskningar, och de posterna är hela underlaget för
 * mätningen av hur ofta maskinen har rätt.
 */
@Component({
  selector: 'app-pass',
  host: { 'data-density': 'compact' },
  imports: [RouterLink],
  templateUrl: './pass.component.html',
  styleUrl: './pass.component.css',
})
export class PassComponent {
  private readonly router = inject(Router);

  readonly falt = FALT;

  readonly lista = signal<Rad[] | null>(null);
  readonly total = signal(0);
  readonly pos = signal(0);
  readonly receipt = signal<Receipt | null>(null);
  readonly utkast = signal<Record<string, string>>(tomtUtkast());
  readonly klara = signal<ReadonlySet<string>>(new Set());
  readonly sparar = signal(false);
  readonly error = signal<string | null>(null);

  private readonly faltInput = viewChildren<ElementRef<HTMLInputElement>>('faltInput');

  /** Passet är slut när kön är genomgången — eller när den var tom från början. */
  readonly klart = computed(() => {
    const list = this.lista();
    return list !== null && this.pos() >= list.length;
  });

  readonly antal = computed(() => this.lista()?.length ?? 0);
  readonly andel = computed(() => (this.antal() === 0 ? 0 : Math.round((this.pos() / this.antal()) * 100)));

  /**
   * Hur många fler som väntar än passet tog med sig. Syns bara när den är större än
   * noll — annars vore den en påminnelse om ingenting.
   */
  readonly utanfor = computed(() => Math.max(0, this.total() - this.antal()));

  constructor() {
    void this.borja();
  }

  async borja(): Promise<void> {
    this.error.set(null);
    // Ett nytt pass räknar sitt eget arbete. Annars vore siffran på slutskärmen en
    // summa över dagen, och den påstår något annat än den ser ut att påstå.
    this.klara.set(new Set());
    try {
      const svar = await fetch('/api/pass');
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      const { total, receipts } = (await svar.json()) as { total: number; receipts: Rad[] };
      this.total.set(total);
      this.lista.set(receipts);
      this.pos.set(0);
      if (receipts.length > 0) await this.laddaKvitto(receipts[0]!.id);
    } catch {
      this.error.set('Kunde inte hämta arbetslistan. Är servern igång?');
      this.lista.set([]);
    }
  }

  // ---- kön ------------------------------------------------------------

  readonly nuvarande = computed<Rad | null>(() => this.lista()?.[this.pos()] ?? null);

  ardag(rad: Rad): boolean {
    return rad.id === this.nuvarande()?.id;
  }

  /** Ett kvitto som fått en rättelse eller en bekräftelse under det här passet. */
  arKlar(rad: Rad): boolean {
    return this.klara().has(rad.id);
  }

  /** Ett hopp i listan är samma sak som att gå vidare: det orörda sparas inte. */
  gaTill(i: number): void {
    // Ett klick på raden man redan står på ska inte kasta det man håller på att skriva.
    if (i === this.pos()) return;
    void this.ko(async () => {
      this.pos.set(i);
      const rad = this.lista()?.[i];
      if (rad) await this.laddaKvitto(rad.id);
    });
  }

  private async laddaKvitto(id: string): Promise<void> {
    this.receipt.set(null);
    this.utkast.set(tomtUtkast());
    try {
      const svar = await fetch(`/api/receipts/${id}`);
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      const receipt = (await svar.json()) as Receipt;
      this.receipt.set(receipt);
      this.fyllUtkast(receipt);
      // Fokus går dit arbetet är: första fältet ingen granskat. Efter renderingen,
      // för det är då fälten finns att fokusera.
      setTimeout(() => this.fokusera(this.forstaOgranskade()), 0);
    } catch {
      this.error.set('Kunde inte hämta kvittot.');
    }
  }

  private async gaVidare(): Promise<void> {
    const i = this.pos() + 1;
    this.pos.set(i);
    const rad = this.lista()?.[i];
    if (!rad) return void this.receipt.set(null);
    await this.laddaKvitto(rad.id);
  }

  // ---- utkasten -------------------------------------------------------

  private fyllUtkast(receipt: Receipt): void {
    const ut = tomtUtkast();
    for (const f of FALT) ut[f.namn] = this.somText(receipt.fields?.[f.namn], f.sort);
    this.utkast.set(ut);
  }

  /** Beloppet skrivs med komma, som på kvittot och som man skriver det. */
  private somText(falt: Falt | undefined, sort: 'text' | 'tal'): string {
    if (falt === undefined) return '';
    return sort === 'tal' ? String(falt.value).replace('.', ',') : String(falt.value);
  }

  onUtkast(namn: Namn, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.utkast.update((u) => ({ ...u, [namn]: value }));
  }

  varde(namn: Namn): Falt | undefined {
    return this.receipt()?.fields?.[namn];
  }

  /** Maskinläst och orört. Det är den enda skillnaden panelen behöver markera. */
  maskinlast(namn: Namn): boolean {
    const falt = this.varde(namn);
    return falt === undefined || falt.source === 'ocr';
  }

  private forstaOgranskade(): number {
    const i = FALT.findIndex((f) => this.maskinlast(f.namn));
    return i === -1 ? 0 : i;
  }

  /** Esc: tillbaka till det maskinen läste, inte tomt. */
  angra(namn: Namn): void {
    const receipt = this.receipt();
    if (!receipt) return;
    const sort = FALT.find((f) => f.namn === namn)!.sort;
    this.utkast.update((u) => ({ ...u, [namn]: this.somText(receipt.fields?.[namn], sort) }));
  }

  angraAllt(): void {
    const receipt = this.receipt();
    if (receipt) this.fyllUtkast(receipt);
  }

  // ---- att spara ------------------------------------------------------

  /**
   * Vad fältet ska skickas som — eller `null` för "ingenting att skicka".
   *
   * Tre utfall, och skillnaden mellan dem är hela mätvärdet: ett ändrat värde är en
   * rättelse, ett orört maskinläst värde som någon gått förbi är en bekräftelse
   * ("maskinen hade rätt vid konfidens 0,61"), och ett fält som redan är granskat är
   * ingenting alls — att skriva en andra bekräftelse vore att räkna samma blick två gånger.
   */
  private rattelse(namn: Namn): Rattelse | null {
    const sort = FALT.find((f) => f.namn === namn)!.sort;
    const skrivet = (this.utkast()[namn] ?? '').trim();
    if (!skrivet) return null;

    const befintligt = this.varde(namn);
    if (sort === 'tal') {
      const tal = Number(skrivet.replace(',', '.'));
      if (!Number.isFinite(tal)) return null;
      if (befintligt === undefined) return { namn, value: tal, bekraftat: false };
      const lika = Number(befintligt.value) === tal;
      if (lika && befintligt.source !== 'ocr') return null;
      return { namn, value: tal, bekraftat: lika };
    }

    if (befintligt === undefined) return { namn, value: skrivet, bekraftat: false };
    const lika = String(befintligt.value) === skrivet;
    if (lika && befintligt.source !== 'ocr') return null;
    return { namn, value: skrivet, bekraftat: lika };
  }

  /**
   * En kö om ett steg. Två skrivningar mot samma kvitto samtidigt vore två
   * läs-ändra-skriv över samma sidecar, och den ena skulle försvinna utan ett ljud.
   * Det får aldrig hända, och det får inte heller kosta väntan: fokus flyttar direkt,
   * skrivningen ställer sig i ledet.
   */
  private kedja: Promise<unknown> = Promise.resolve();

  private ko<T>(arbete: () => Promise<T>): Promise<T> {
    const nasta = this.kedja.then(arbete, arbete);
    this.kedja = nasta.then(
      () => undefined,
      () => undefined,
    );
    return nasta;
  }

  /** Kastar aldrig: felet blir en rad i gränssnittet, inte ett avbrutet pass. */
  private async spara(id: string, rattelser: Rattelse[]): Promise<boolean> {
    if (rattelser.length === 0) return true;
    this.sparar.set(true);
    try {
      const svar = await fetch(`/api/receipts/${id}/falt/flera`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rattelser }),
      });
      if (svar.status === 401) {
        await this.router.navigateByUrl('/logga-in');
        return false;
      }
      if (!svar.ok) throw new Error(String(svar.status));
      const receipt = (await svar.json()) as Receipt;
      // Bara om vi står kvar på samma kvitto — annars vore svaret ett eko som skrev
      // över det man just tagit in.
      if (this.receipt()?.id === id) this.receipt.set(receipt);
      this.uppdateraRad(receipt);
      this.klara.update((k) => new Set(k).add(id));
      this.error.set(null);
      return true;
    } catch {
      this.error.set('Rättelsen gick inte att spara. Kvittot står kvar i listan.');
      return false;
    } finally {
      this.sparar.set(false);
    }
  }

  /**
   * Arbetslistan speglar det som sparats. Utan det står raden kvar och säger "okänd
   * butik" om en butik man just skrivit in, och listan blir en bild av hur det såg ut
   * när passet började i stället för av vad man gjort.
   */
  private uppdateraRad(receipt: Receipt): void {
    this.lista.update(
      (list) =>
        list?.map((rad) =>
          rad.id === receipt.id
            ? {
                ...rad,
                store: (receipt.fields?.['store']?.value as string) ?? null,
                date: (receipt.fields?.['date']?.value as string) ?? null,
                total: (receipt.fields?.['total']?.value as number) ?? null,
              }
            : rad,
        ) ?? null,
    );
  }

  /** `Enter` i ett fält: spara det, och fall vidare. I det sista: ta in nästa kvitto. */
  enter(i: number): void {
    const id = this.receipt()?.id;
    if (!id) return;
    const rattelse = this.rattelse(FALT[i]!.namn);

    if (i < FALT.length - 1) {
      this.fokusera(i + 1);
      if (rattelse) void this.ko(() => this.spara(id, [rattelse]));
      return;
    }
    void this.ko(async () => {
      if (rattelse && !(await this.spara(id, [rattelse]))) return;
      await this.gaVidare();
    });
  }

  /** Knappen: allt som ännu inte sparats går i en enda skrivning, sedan nästa kvitto. */
  sparaOchNasta(): void {
    const id = this.receipt()?.id;
    if (!id) return;
    const rattelser = FALT.map((f) => this.rattelse(f.namn)).filter((r): r is Rattelse => r !== null);
    void this.ko(async () => {
      if (!(await this.spara(id, rattelser))) return;
      await this.gaVidare();
    });
  }

  hoppaOver(): void {
    void this.ko(() => this.gaVidare());
  }

  avsluta(): void {
    void this.router.navigateByUrl('/arkiv');
  }

  private fokusera(i: number): void {
    const el = this.faltInput()[i]?.nativeElement;
    if (!el) return;
    el.focus();
    el.select();
  }

  // ---- att visa -------------------------------------------------------

  bild(file: string): string {
    const id = this.receipt()?.id ?? '';
    return `/api/receipts/${id}/files/${file}`;
  }

  /** Kvittots eget datum om det finns, annars när det fångades. Aldrig ett påhitt. */
  radrubrik(rad: Rad): string {
    const iso = rad.date ?? rad.capturedAt;
    return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  }

  belopp(rad: Rad): string {
    return rad.total === null ? '—' : rad.total.toFixed(2).replace('.', ',');
  }
}
