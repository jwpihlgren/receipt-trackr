import { Component, computed, effect, inject, signal } from '@angular/core';
import { NgStyle } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MenyComponent } from '../shared/meny.component';
import { BildvisareComponent, type VisadBild } from '../shared/bildvisare.component';
import { TolkningService } from '../ocr/tolkning.service';
import { datum, tid } from '../shared/datum';

type Segment = {
  file: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  /** Vad en människa sagt om bildens riktning. Saknas den står bilden som den kom. */
  rotation?: 0 | 90 | 180 | 270;
};

/** Ett annat fotografi av samma köp. Servern räknar fram gruppen ur kvittots nummer. */
type Gruppmedlem = { id: string; capturedAt: string; segments: number };

export type Falt = {
  value: string | number;
  confidence: number;
  source: 'ocr' | 'manual' | 'confirmed';
  candidates?: { value: string | number; confidence: number }[];
};

/** Fälten i den ordning de läses på ett kvitto, inte i den ordning de utvinns. */
const FALT: { namn: 'store' | 'date' | 'total'; etikett: string; sort: 'text' | 'tal' }[] = [
  { namn: 'store', etikett: 'BUTIK', sort: 'text' },
  { namn: 'date', etikett: 'DATUM', sort: 'text' },
  { namn: 'total', etikett: 'BELOPP', sort: 'tal' },
];

type Lage = 'bilder' | 'ofullstandig' | 'vantar' | 'utan_text' | 'svag_text' | 'saknar_falt';

type Receipt = {
  id: string;
  capturedAt: string;
  backlog: boolean;
  segments: Segment[];
  expectedSegments: number | null;
  completedAt: string | null;
  fields: Record<string, Falt | undefined>;
  text: string;
  tags: { user: string[]; auto: string[] };
  lostSegments?: { at: string; utlovade: number; faktiska: number };
  kasserade?: { at: string; index: number; sha256: string; orsak: 'ersatt' | 'borttagen' }[];
  /** Kvitton som visar samma köp, eller `null` när det här är ensamt om sitt. */
  grupp: { id: string; medlemmar: Gruppmedlem[] } | null;
  /** Kategorin som gäller: kvittots egen om någon satt en, annars butikens regel. */
  kategori: string | null;
  /** Kategorierna som finns, i den ordning som ger dem färg. */
  kategorier: string[];
  /** Satt bara när en människa gett *det här* kvittot en egen kategori. */
  kategori_egen?: { value: string; at: string };
  /** Kvitton en människa sagt att det här inte är samma köp som. */
  inteSamma?: string[];
  /** Varför kvittot står i aktiviteten. `null` betyder klart. Härlett av servern. */
  lage: Lage | null;
  saknadeFalt: string[];
};

/**
 * Läsvyn för ett kvitto: bilden till vänster, det vi vet om det till höger.
 *
 * Segmenten staplas kant i kant i en kolumn i stället för att ligga i flikar —
 * papperet var ett papper, och skarven mellan två bilder är något man vill kunna följa
 * med blicken. Saknas ett segment står en lucka där i stället för att bilderna sluter
 * sig runt hålet; ett kvitto med en tappad mittbit ska inte se helt ut.
 *
 * Fältpanelen står tom tills textutläsningen finns. Att rita ut butik, datum och
 * belopp med påhittade värden hade varit att bygga skärmen färdig på bekostnad av att
 * den säger sanningen.
 */
@Component({
  selector: 'app-kvitto',
  imports: [RouterLink, NgStyle, MenyComponent, BildvisareComponent],
  templateUrl: './kvitto.component.html',
})
export class KvittoComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly tolkning = inject(TolkningService);
  readonly tolkar = signal(false);

  readonly receipt = signal<Receipt | null>(null);
  readonly error = signal<string | null>(null);
  readonly visaText = signal(false);

  /**
   * Adressens egna värden, som signaler.
   *
   * `route.snapshot` läses en gång, och Angular återanvänder komponenten när man går
   * från ett kvitto till ett annat — galleriets länk till syskonfotot bytte adress
   * men hade fortsatt visa det första kvittot.
   */
  private readonly params = toSignal(this.route.paramMap);
  private readonly fragor = toSignal(this.route.queryParamMap);

  readonly id = computed(() => this.params()?.get('id') ?? this.route.snapshot.paramMap.get('id') ?? '');

  /**
   * Varifrån man kom. Aktiviteten är en annan resa än arkivet: den som rättat ett
   * kvitto där ska tillbaka till listan över det som inte är klart, inte till arkivet.
   */
  readonly fran = computed(() => this.fragor()?.get('fran') ?? this.route.snapshot.queryParamMap.get('fran'));

  /**
   * Vilken yta kvittot öppnades från. Samma skärm, men bakåtlänken och menyn ska
   * leda tillbaka dit man kom ifrån — tidigare kastades den som tryckte på ett
   * kvitto i telefonen permanent in i datorläget.
   */
  readonly yta = computed<'mobil' | 'dator'>(() =>
    this.route.snapshot.url.some((s) => s.path === 'telefon') ? 'mobil' : 'dator',
  );
  readonly tillbakaLank = computed(() => {
    const yta = this.yta() === 'mobil' ? '/telefon' : '/dator';
    return this.fran() === 'aktivitet' ? `${yta}/aktivitet` : `${yta}/kvitton`;
  });
  readonly tillbakaNamn = computed(() => (this.fran() === 'aktivitet' ? 'Aktivitet' : 'Kvitton'));

  /** Fångsten är oavslutad om klienten aldrig hann säga hur många bilder kvittot har. */
  readonly oavslutat = computed(() => this.receipt()?.completedAt === null);

  /** Bilder som utlovats men aldrig kom fram. Den viktigaste siffran på hela sidan. */
  readonly saknade = computed(() => {
    const r = this.receipt();
    if (!r || r.expectedSegments === null) return 0;
    return Math.max(0, r.expectedSegments - r.segments.length);
  });

  readonly harText = computed(() => (this.receipt()?.text ?? '').trim().length > 0);

  readonly falt = FALT;
  readonly utkast = signal<Record<string, string>>({ store: '', date: '', total: '' });

  /**
   * Fel per fält, inte ett larm högst upp på sidan.
   *
   * Ett valideringsfel hör till det fält som är fel — röd kant på fältet och
   * meddelandet direkt under, knutet med aria-describedby. Det är vad varje annat
   * formulär på webben gör, och det jag redan gjorde på inloggningssidan.
   */
  readonly faltFel = signal<Record<string, string>>({});
  readonly sparar = signal(false);
  readonly sparat = signal(false);

  /** Vilken av kvittots bilder som visas stor. Index i `segments`, inte segmentnummer. */
  readonly vald = signal(0);
  readonly visaren = signal(false);
  /** Bilden som väntar på ett ja innan den kasseras. `null` när ingen fråga står. */
  readonly fragarKassera = signal<number | null>(null);

  /**
   * Bilderna som de ska visas: adressen bär bildens sha256.
   *
   * Filerna cachas hårt därför att de är oföränderliga — men en människa får ersätta
   * en dålig bild, och då är filnamnet detsamma medan innehållet är ett annat. Att
   * lägga summan i adressen håller båda sanningarna: gamla adressen pekade på gamla
   * bytesen, och den nya bilden hämtas därför att den har en annan adress.
   */
  readonly bilder = computed<VisadBild[]>(() =>
    (this.receipt()?.segments ?? []).map((s, i) => ({
      file: s.file,
      index: i + 1,
      url: `${this.bild(s.file)}?v=${s.sha256.slice(0, 12)}`,
      width: s.width,
      height: s.height,
      rotation: s.rotation ?? 0,
    })),
  );

  readonly aktuell = computed<VisadBild | null>(() => this.bilder()[this.vald()] ?? null);

  /** Nästa lediga segmentnummer. Nummer återanvänds inte — en kasserad bilds plats står tom. */
  private nastaNummer(): number {
    const r = this.receipt();
    const hogsta = (r?.segments ?? []).reduce((h, s) => Math.max(h, Number(s.file.slice(8, 10))), 0);
    return hogsta + 1;
  }

  /**
   * Ramens proportion. En bild som ligger ned är lika bred som den är hög, tvärtom —
   * och ramen måste bära de måtten, annars lägger sig den vridna bilden utanför.
   */
  ramAspekt(b: VisadBild): string {
    return b.rotation % 180 === 90 ? `${b.height} / ${b.width}` : `${b.width} / ${b.height}`;
  }

  /** Bilden fyller ramen och vrids om sin egen mitt. */
  bildStil(b: VisadBild): Record<string, string> {
    if (b.rotation % 180 === 0) {
      return { width: '100%', height: '100%', transform: `rotate(${b.rotation}deg)` };
    }
    return {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: `${(b.width / b.height) * 100}%`,
      height: `${(b.height / b.width) * 100}%`,
      transform: `translate(-50%, -50%) rotate(${b.rotation}deg)`,
    };
  }

  /**
   * En människa säger vad butiken är.
   *
   * Normalvägen ändrar **regeln**: butiken betyder något annat nu, och alla kvitton
   * därifrån följer med — det var beställarens val, och det som gör trettio kvitton
   * kategoriserade utan att någon betar av en lista. Saknar kvittot butik finns bara
   * kvittots egen kategori kvar att sätta.
   */
  async valjKategori(event: Event): Promise<void> {
    const kategori = (event.target as HTMLSelectElement).value;
    const butik = this.varde('store')?.value;
    if (typeof butik === 'string' && butik.trim()) {
      await this.skriv('/api/kategorier/regel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ butik, kategori }),
      });
      return;
    }
    await this.sattEgenKategori(kategori);
  }

  /** Frågan står tills den besvaras: separationen är inte oåterkallelig, men den syns. */
  readonly fragarSkilja = signal(false);

  /**
   * "Inte samma köp".
   *
   * Matchningen slår ihop köp åt en, och en felaktig sammanslagning döljer ett köp
   * utan att synas. Det här är vägen ut — och den går att ta tillbaka, för ett nej
   * som inte går att ångra vore ett nytt sätt att förlora ett köp.
   */
  async skiljAt(): Promise<void> {
    this.fragarSkilja.set(false);
    await this.skriv(`/api/receipts/${this.id()}/inte-samma`, { method: 'POST' });
  }

  async aterforena(): Promise<void> {
    await this.skriv(`/api/receipts/${this.id()}/inte-samma`, { method: 'DELETE' });
  }

  /** Undantaget: butiken säljer allt, och det här kvittot är något annat. */
  async sattEgenKategori(kategori: string | null): Promise<void> {
    await this.skriv(`/api/receipts/${this.id()}/kategori`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kategori }),
    });
  }

  tumnagel(index: number): string {
    return `/api/receipts/${this.id()}/thumbs/${index}`;
  }

  oppnaVisaren(index: number): void {
    this.vald.set(index);
    this.visaren.set(true);
  }

  /** Vridningen sparas på kvittot — den är en människas ord om bilden, inte en vy. */
  async vridBild(handelse: { index: number; rotation: 0 | 90 | 180 | 270 }): Promise<void> {
    await this.skriv(`/api/receipts/${this.id()}/segments/${handelse.index}/rotation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rotation: handelse.rotation }),
    });
  }

  /** Ersätter en dålig bild med ett nytt fotografi av samma papper. */
  async ersattBild(index: number, event: Event): Promise<void> {
    const fil = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    if (!fil) return;
    const kropp = new FormData();
    kropp.append('file', fil);
    await this.skriv(`/api/receipts/${this.id()}/segments/${index}`, { method: 'PUT', body: kropp });
  }

  /** Lägger till en bild på ett kvitto som redan ligger i arkivet. */
  async laggTillBild(event: Event): Promise<void> {
    const fil = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    if (!fil) return;
    const nummer = this.nastaNummer();
    const kropp = new FormData();
    kropp.append('file', fil);
    const skickat = await this.skriv(`/api/receipts/${this.id()}/segments/${nummer}`, {
      method: 'POST',
      body: kropp,
      // Antalet utlovade bilder höjs efteråt: kvittot är helt först när bilden ligger
      // i arkivet, inte när uppladdningen börjat.
    });
    if (!skickat) return;
    await this.skriv(`/api/receipts/${this.id()}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segments: this.receipt()?.segments.length ?? nummer }),
    });
  }

  async kasseraBild(index: number): Promise<void> {
    this.fragarKassera.set(null);
    await this.skriv(`/api/receipts/${this.id()}/segments/${index}`, { method: 'DELETE' });
    this.vald.set(0);
  }

  /**
   * En skrivning mot kvittot, med samma tre svar överallt: 401 leder till inloggningen,
   * ett fel säger till, och det som lyckas hämtar om kvittot. Utan det sista visade
   * skärmen den gamla bilden efter en vridning som faktiskt gått igenom.
   */
  private async skriv(url: string, init: RequestInit): Promise<boolean> {
    this.sparar.set(true);
    try {
      const svar = await fetch(url, init);
      if (svar.status === 401) {
        await this.router.navigateByUrl('/logga-in');
        return false;
      }
      if (!svar.ok) throw new Error(String(svar.status));
      await this.load();
      return true;
    } catch {
      this.error.set('Ändringen gick inte att spara.');
      return false;
    } finally {
      this.sparar.set(false);
    }
  }

  varde(namn: string): Falt | undefined {
    return this.receipt()?.fields?.[namn];
  }

  private text(namn: string): string {
    const f = this.varde(namn);
    if (f === undefined) return '';
    return namn === 'total' ? String(f.value).replace('.', ',') : String(f.value);
  }

  private fyllUtkast(): void {
    this.utkast.set(Object.fromEntries(FALT.map((f) => [f.namn, this.text(f.namn)])));
  }

  onUtkast(namn: string, event: Event): void {
    this.sparat.set(false);
    this.utkast.update((u) => ({ ...u, [namn]: (event.target as HTMLInputElement).value }));
    // Felet gäller det som stod där, inte det man håller på att skriva.
    if (this.faltFel()[namn]) this.faltFel.update(({ [namn]: _, ...kvar }) => kvar);
  }

  /**
   * Samma regler som servern, körda innan anropet.
   *
   * Dubbleringen är avsiktlig: servern äger arkivets innehåll och måste pröva,
   * men att skicka iväg något man redan vet är fel — och vänta på svaret — är en
   * sämre upplevelse än att säga till direkt.
   */
  private prova(): Record<string, string> {
    const fel: Record<string, string> = {};
    for (const f of FALT) {
      const skrivet = (this.utkast()[f.namn] ?? '').trim();
      if (!skrivet) continue;
      if (f.namn === 'date') {
        const träff = /^(\d{4})-(\d{2})-(\d{2})$/.exec(skrivet);
        if (!träff) {
          fel[f.namn] = 'Skriv datumet som ÅÅÅÅ-MM-DD.';
          continue;
        }
        const [år, månad, dag] = [Number(träff[1]), Number(träff[2]), Number(träff[3])];
        const d = new Date(Date.UTC(år, månad - 1, dag));
        if (d.getUTCFullYear() !== år || d.getUTCMonth() !== månad - 1 || d.getUTCDate() !== dag) {
          fel[f.namn] = `Det finns ingen ${skrivet}.`;
        }
      } else if (f.sort === 'tal') {
        const tal = Number(skrivet.replace(',', '.'));
        if (!Number.isFinite(tal)) fel[f.namn] = 'Beloppet ska vara ett tal.';
        else if (tal < 0) fel[f.namn] = 'Beloppet kan inte vara negativt.';
      }
    }
    return fel;
  }

  /** Vad som skiljer formuläret från det som ligger i arkivet. Tomma fält hoppas över. */
  private andringar(): { namn: string; value: string | number; bekraftat: boolean }[] {
    const ut: { namn: string; value: string | number; bekraftat: boolean }[] = [];
    for (const f of FALT) {
      const skrivet = (this.utkast()[f.namn] ?? '').trim();
      if (!skrivet) continue;
      const befintligt = this.varde(f.namn);
      if (f.sort === 'tal') {
        const tal = Number(skrivet.replace(',', '.'));
        if (!Number.isFinite(tal)) continue;
        if (befintligt !== undefined && Number(befintligt.value) === tal) continue;
        ut.push({ namn: f.namn, value: tal, bekraftat: false });
      } else {
        if (befintligt !== undefined && String(befintligt.value) === skrivet) continue;
        ut.push({ namn: f.namn, value: skrivet, bekraftat: false });
      }
    }
    return ut;
  }

  readonly harAndringar = computed(() => {
    // Läser signalerna så att knappen räknas om när man skriver.
    this.utkast();
    this.receipt();
    return this.andringar().length > 0;
  });

  async spara(): Promise<void> {
    const fel = this.prova();
    this.faltFel.set(fel);
    if (Object.keys(fel).length > 0) return;

    const rattelser = this.andringar();
    if (rattelser.length === 0) return;
    this.sparar.set(true);
    try {
      const svar = await fetch(`/api/receipts/${this.id()}/falt/flera`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rattelser }),
      });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (svar.status === 400) {
        // Servern säger vilket fält som var fel; meddelandet hör hemma vid det.
        const { namn, message } = (await svar.json()) as { namn?: string; message?: string };
        const text = message ?? 'Värdet gick inte att spara.';
        if (namn) this.faltFel.update((f) => ({ ...f, [namn]: text }));
        else this.error.set(text);
        return;
      }
      if (!svar.ok) throw new Error(String(svar.status));
      this.receipt.set((await svar.json()) as Receipt);
      this.fyllUtkast();
      this.sparat.set(true);
      setTimeout(() => this.sparat.set(false), 3000);
      this.error.set(null);
    } catch {
      this.error.set('Rättelsen gick inte att spara.');
    } finally {
      this.sparar.set(false);
    }
  }

  /** Tolkar kvittot här och nu, i den här webbläsaren. */
  async tolkaNu(): Promise<void> {
    this.tolkar.set(true);
    try {
      await this.tolkning.koraEtt(this.id());
      await this.load();
    } catch {
      this.error.set('Tolkningen gick inte att köra.');
    } finally {
      this.tolkar.set(false);
    }
  }

  /** Kastar texten och läser om bilden direkt. Bilderna är kvar; rättelser också. */
  async lasOm(): Promise<void> {
    this.tolkar.set(true);
    try {
      const svar = await fetch(`/api/receipts/${this.id()}/lasom`, { method: 'POST' });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      await this.tolkning.koraEtt(this.id());
      await this.load();
    } catch {
      this.error.set('Kvittot gick inte att läsa om.');
    } finally {
      this.tolkar.set(false);
    }
  }

  /**
   * Vad som saknas, i klartext. Den som klickat på en rad i aktiviteten ska mötas av
   * samma ord här som stod där — inte gissa vad som förväntas.
   */
  readonly hinder = computed<string | null>(() => {
    const r = this.receipt();
    if (!r?.lage) return null;
    switch (r.lage) {
      case 'bilder':
        return `${this.saknade()} ${this.saknade() === 1 ? 'bild' : 'bilder'} kom aldrig fram.`;
      case 'ofullstandig':
        return 'Telefonen hann aldrig säga hur många bilder kvittot har.';
      case 'vantar':
        return 'Kvittot väntar på tolkning.';
      case 'utan_text':
        return 'Tolkningen kördes men läste ingen text.';
      case 'svag_text':
        return 'Bilden gick knappt att läsa — värdena kan vara fel rakt igenom.';
      case 'saknar_falt':
        return `Maskinen hittade inte ${r.saknadeFalt.join(' eller ')}.`;
    }
  });

  /**
   * "Fälten stämmer" finns bara när något är flaggat.
   *
   * Ett kvitto i arkivet är per definition rätt och ska inte behöva hävda sig. Men ett
   * kvitto som flaggats för svag text kunde tidigare inte bli kvitt flaggan alls: Spara
   * är avstängd när inget ändrats, så enda vägen var att skriva om alla tre värdena
   * till något annat och tillbaka.
   */
  readonly kanBekrafta = computed(() => {
    const r = this.receipt();
    if (!r?.lage || r.lage === 'vantar' || r.lage === 'saknar_falt') return false;
    return FALT.every((f) => this.varde(f.namn) !== undefined);
  });

  /** Bekräftar maskinens läsning av alla tre fälten i en enda skrivning. */
  async bekraftaAlla(): Promise<void> {
    const rattelser = FALT.filter((f) => this.varde(f.namn) !== undefined).map((f) => ({
      namn: f.namn,
      value: this.varde(f.namn)!.value,
      bekraftat: true,
    }));
    await this.skickaOchLadda(`/api/receipts/${this.id()}/falt/flera`, { rattelser });
  }

  /** Avslutar en fångst telefonen aldrig hann avsluta. */
  avsluta(): Promise<void> {
    return this.skickaOchLadda(`/api/receipts/${this.id()}/avsluta`);
  }

  /** Konstaterar att en utlovad bild är borta. Förlusten skrivs ned i arkivet. */
  bilderBorta(): Promise<void> {
    return this.skickaOchLadda(`/api/receipts/${this.id()}/bilder-borta`);
  }

  private async skickaOchLadda(url: string, kropp?: unknown): Promise<void> {
    this.sparar.set(true);
    try {
      const svar = await fetch(url, {
        method: 'POST',
        ...(kropp === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(kropp) }),
      });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      await this.load();
    } catch {
      this.error.set('Det gick inte att spara.');
    } finally {
      this.sparar.set(false);
    }
  }

  readonly vissRadera = signal(false);

  /**
   * Två steg med flit. Bilderna finns ingen annanstans och papperet är slängt, så det
   * här är den enda handlingen i appen som inte går att ta tillbaka.
   */
  fragaRadera(): void {
    this.vissRadera.set(true);
  }

  avbrytRadera(): void {
    this.vissRadera.set(false);
  }

  async radera(): Promise<void> {
    this.sparar.set(true);
    try {
      const svar = await fetch(`/api/receipts/${this.id()}`, { method: 'DELETE' });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok && svar.status !== 404) throw new Error(String(svar.status));
      await this.router.navigateByUrl(`${this.tillbakaLank()}?raderat=1`);
    } catch {
      this.error.set('Kvittot gick inte att ta bort.');
      this.sparar.set(false);
    }
  }

  constructor() {
    // Hämtar om när adressen byter kvitto — annars visade skärmen det förra kvittot
    // efter ett klick i galleriet, med rätt adress i fältet.
    effect(() => {
      const id = this.id();
      if (!id) return;
      this.vald.set(0);
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const response = await fetch(`/api/receipts/${this.id()}`);
      if (response.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (response.status === 404) {
        this.error.set('Kvittot finns inte i arkivet.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const receipt = (await response.json()) as Receipt;
      this.receipt.set(receipt);
      this.fyllUtkast();
      // Finns text men inga fält är texten det enda som faktiskt går att visa. Att
      // gömma den bakom en knapp gjorde att tolkningen såg ut att inte ha hänt.
      if (receipt.text.trim().length > 0 && Object.keys(receipt.fields).length === 0) {
        this.visaText.set(true);
      }
    } catch {
      this.error.set('Kvittot gick inte att hämta. Försök igen.');
    }
  }

  bild(file: string): string {
    return `/api/receipts/${this.id()}/files/${file}`;
  }

  readonly datum = datum;
  readonly klocka = tid;

  toggleText(): void {
    this.visaText.update((v) => !v);
  }
}
