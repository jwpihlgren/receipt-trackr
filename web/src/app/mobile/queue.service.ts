/**
 * Kön mellan telefonen och servern.
 *
 * En regel bär hela filen: **den lokala kopian raderas först när servern svarat med
 * samma sha256** — inte när HTTP-svaret var 200, inte när uppladdningen "gick igenom".
 * Bilderna är oåterkalleliga, allt annat går att göra om, och den asymmetrin får kosta
 * lagringsutrymme i telefonen så länge det behövs.
 *
 * Uppladdningen ligger aldrig i fångstvägen. Den startar när något lagts i kön, när
 * appen får fokus, och med jämna mellanrum — men användaren väntar aldrig på den.
 */
import { Injectable, computed, signal } from '@angular/core';
import { allReceipts, allSegments, deleteReceipt, deleteSegment, putReceipt, putSegment, segmentsFor, type QueuedReceipt, type QueuedSegment } from './db';

/**
 * Ett kvitto servern vägrat ta emot, med skälet kvar.
 *
 * Skälet fanns tidigare bara som ett id i en lista, vilket gjorde alla avvisningar
 * lika: en bild servern inte kan läsa fick samma "Försök igen" som en krock som en
 * människa kan lösa vid datorn. `gorOm` skiljer dem åt — det är sant bara när ett
 * nytt försök faktiskt kan sluta annorlunda.
 */
export type Fastnat = {
  id: string;
  /** HTTP-statusen servern gav. 0 betyder att bytesen inte kom fram hela. */
  status: number;
  skal: string;
  gorOm: boolean;
};

export type QueueState = {
  /** Sant när servern svarat 401 eller 403. Kön vilar då tills någon loggat in igen. */
  utloggad: boolean;
  /** Kvitton som ännu inte är helt kvitterade av servern. Det är siffran krav 3 vill ha. */
  waiting: number;
  /** Segment kvar att skicka, för den som vill veta varför det tar tid. */
  pendingSegments: number;
  uploading: boolean;
  offline: boolean;
  /** Kvitton där ett segment vägrats av servern och som behöver hanteras av en människa. */
  stuck: Fastnat[];
  /**
   * Nycklarna (`kvitto:nummer`) som ännu ligger kvar lokalt. En bild försvinner ur
   * mängden först när servern kvitterat samma sha256 — därför är den här mängden
   * också svaret på "har bilden kommit fram?", och inte bara "har vi försökt?".
   */
  pending: string[];
  /** Kvitton som ännu ligger kvar lokalt. Tomt = allt är i arkivet. */
  receipts: string[];
  /** Antal kvitton som nått arkivet i dag. Överlever omladdning, nollas vid midnatt. */
  archivedToday: number;
};

const TODAY_KEY = 'receipt-trackr:arkiverade';

function readToday(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(TODAY_KEY) ?? '{}') as { date?: string; n?: number };
    return raw.date === new Date().toDateString() ? (raw.n ?? 0) : 0;
  } catch {
    return 0;
  }
}

function writeToday(n: number): void {
  try {
    localStorage.setItem(TODAY_KEY, JSON.stringify({ date: new Date().toDateString(), n }));
  } catch {
    // Räknaren är en trevlighet. Går den inte att spara är det ingenting att larma om.
  }
}

/**
 * Vad avvisningen betyder, och om ett nytt försök kan sluta annorlunda.
 *
 * Bara krocken är värd att försöka om: den uppstår när ett kvitto redan ligger i
 * arkivet med annat innehåll, och den går över så fort någon rett ut det vid datorn.
 * En oläsbar bild och en för stor bild ser likadana ut hur många gånger de än
 * skickas — de raderna har en annan väg ut, inte en knapp som låtsas arbeta.
 */
function anledning(status: number): Omit<Fastnat, 'id'> {
  switch (status) {
    case 0:
      // Bytesen ändrades på vägen, inte i servern: den har inte dömt bilden, den fick
      // en annan. Ett nytt försök kan sluta annorlunda — och gör det inte det svarar
      // servern 409 nästa gång, vilket är ett ärligare besked än tystnad.
      return { status, skal: 'Bilden kom fram med andra bytes än de som skickades.', gorOm: true };
    case 409:
      return { status, skal: 'Kvittot finns redan i arkivet med ett annat innehåll.', gorOm: true };
    case 413:
      return { status, skal: 'Bilden är för stor för servern.', gorOm: false };
    case 415:
      return { status, skal: 'Servern kunde inte läsa bilden.', gorOm: false };
    default:
      return { status, skal: `Servern avvisade kvittot (${status}).`, gorOm: false };
  }
}

const RETRY_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly state = signal<QueueState>({
    utloggad: false,
    waiting: 0,
    pendingSegments: 0,
    uploading: false,
    offline: !navigator.onLine,
    stuck: [],
    pending: [],
    receipts: [],
    archivedToday: readToday(),
  });

  readonly snapshot = this.state.asReadonly();
  readonly waiting = computed(() => this.state().waiting);
  /** Finns det något ett nytt försök kan lösa? Styr om knappen alls ska stå där. */
  readonly harOmforsok = computed(() => this.state().stuck.some((f) => f.gorOm));

  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Passen köas efter varandra i stället för att ett pågående pass gör nya anrop till
   * tystnad. Skillnaden märks precis när det spelar roll: en bild som läggs i kön medan
   * ett pass redan rullar ska skickas nu, inte om femton sekunder — och den som väntar
   * på `drain()` ska veta att ett pass som startade efter anropet är klart.
   */
  private chain: Promise<void> = Promise.resolve();

  /** Kvitton användaren kastat. Ett pågående pass ska inte skicka mer av dem. */
  private readonly slangda = new Set<string>();

  /**
   * Räknaren finns därför att `refresh()` läser två lager och sedan skriver ett
   * tillstånd. Två läsningar som överlappar kunde avslutas i omvänd ordning, och då
   * skrevs den äldre listan tillbaka över den nyare — kön såg ut att växa av att
   * tömmas. Bara den senast startade läsningen får skriva.
   */
  private lasning = 0;

  /**
   * `drain()` och inte bara `refresh()`: en kö som legat kvar sedan förra sessionen
   * ska försöka när appen öppnas, inte när femtonsekundersklockan råkar slå. Utan
   * det stod ett kvitto och såg ut att skickas i upp till femton sekunder innan
   * något faktiskt hände — och den som öppnat sidan just för att se kön fick
   * stillastående som svar.
   */
  start(): void {
    void this.refresh();
    void this.drain();
    addEventListener('online', this.wake);
    addEventListener('focus', this.wake);
    document.addEventListener('visibilitychange', this.wake);
    this.timer ??= setInterval(this.wake, RETRY_MS);
  }

  stop(): void {
    removeEventListener('online', this.wake);
    removeEventListener('focus', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private readonly wake = (): void => {
    this.state.update((s) => ({ ...s, offline: !navigator.onLine }));
    if (document.visibilityState === 'visible') void this.drain();
  };

  /** Läggs i kön innan användaren ser bilden. Returnerar när bytesen ligger på disk. */
  async enqueueSegment(receiptId: string, index: number, bytes: ArrayBuffer, sha: string, capture: Record<string, unknown>): Promise<void> {
    await putSegment({
      key: `${receiptId}:${index}`,
      receiptId,
      index,
      bytes,
      sha256: sha,
      capture,
      createdAt: Date.now(),
    });
    await putReceipt({ id: receiptId, createdAt: Date.now(), segments: null });
    await this.refresh();
    void this.drain();
  }

  /** "Klart": antalet bilder är nu känt, och kvittot kan räknas som färdigfångat. */
  async completeReceipt(receiptId: string, segments: number): Promise<void> {
    const existing = (await allReceipts()).find((r) => r.id === receiptId);
    await putReceipt({
      id: receiptId,
      createdAt: existing?.createdAt ?? Date.now(),
      segments,
    });
    await this.refresh();
    void this.drain();
  }

  /**
   * Kvittot kastas, på användarens uttryckliga ord.
   *
   * Det är den enda platsen i appen där bilder försvinner utan att ha nått arkivet,
   * och den finns därför att alternativet var värre: en "Avbryt" som laddade upp
   * allt ändå. Regeln om oåterkalleliga bilder skyddar mot tyst förlust — mot en
   * krasch, ett tappat svar, en kapplöpning — inte mot en människa som står med
   * papperet kvar i handen och säger att bilderna inte ska sparas.
   *
   * Raderingen körs i samma kedja som uppladdningen, så att den aldrig krockar med
   * ett pågående pass. Servern kan redan ha hunnit få kvittot; därför går det en
   * radering dit också.
   */
  async discardReceipt(id: string): Promise<void> {
    // Märkningen först: ett pass som redan rullar ska inte skicka mer av kvittot.
    this.slangda.add(id);

    // Sedan det lokala, med en gång. Det är det användaren bad om, och det får inte
    // vänta på ett nät eller på att en pågående uppladdning ska ge sig.
    for (const segment of await segmentsFor(id)) await deleteSegment(segment.key);
    await deleteReceipt(id);
    this.state.update((s) => ({ ...s, stuck: s.stuck.filter((f) => f.id !== id) }));
    await this.refresh();

    // Servern kan redan ha hunnit få kvittot. Den raderingen läggs sist i kedjan, så
    // att den aldrig kommer före ett segment som är på väg upp i samma stund. Går den
    // inte fram ligger kvittot kvar i aktiviteten och kan tas bort där — bytesen i
    // telefonen är borta oavsett, och det var det som bads om.
    this.chain = this.chain
      .then(() => fetch(`/api/receipts/${id}`, { method: 'DELETE' }).then(() => undefined))
      .catch(() => undefined)
      .then(() => {
        this.slangda.delete(id);
      });
  }

  /**
   * "Försök igen": släpp de märkningar ett nytt försök kan lösa, och bara dem.
   *
   * Knappen nollade tidigare allt, även det servern avvisat med 415 — som ger samma
   * svar nästa gång. Utåt såg det ut som en knapp som inte gjorde något. Offline gör
   * den ingenting alls, och det ska synas på knappen i stället för att gissas.
   */
  retryStuck(): Promise<void> {
    if (!navigator.onLine || !this.harOmforsok()) return Promise.resolve();
    this.state.update((s) => ({ ...s, stuck: s.stuck.filter((f) => !f.gorOm) }));
    return this.drain();
  }

  private async refresh(): Promise<void> {
    const min = ++this.lasning;
    const [segments, receipts] = await Promise.all([allSegments(), allReceipts()]);
    if (min !== this.lasning) return;
    this.state.update((s) => ({
      ...s,
      waiting: receipts.length,
      pendingSegments: segments.length,
      pending: segments.map((seg) => seg.key),
      receipts: receipts.map((r) => r.id),
      offline: !navigator.onLine,
    }));
  }

  /**
   * Tömmer kön. En i taget och i nummerordning: servern är en liten fanless-burk, och
   * ordningen gör att ett kvitto blir helt i stället för hålig när nätet försvinner
   * mitt i.
   *
   * Kvitton som redan är avvisade hoppas över. Utan det försökte kön om dem var
   * femtonde sekund för alltid — precis den tysta loopen märkningen finns för att
   * hindra — och "Försök igen" var inte längre användarens beslut utan en klocka.
   */
  drain(): Promise<void> {
    this.chain = this.chain.then(() => this.pass()).catch(() => undefined);
    return this.chain;
  }

  private async pass(): Promise<void> {
    if (!navigator.onLine) return;
    this.state.update((s) => ({ ...s, uploading: true }));
    try {
      const receipts = (await allReceipts()).sort((a, b) => a.createdAt - b.createdAt);
      const segments = await allSegments();
      for (const receipt of receipts) {
        if (this.slangda.has(receipt.id)) continue;
        if (this.state().stuck.some((f) => f.id === receipt.id)) continue;
        const mine = segments.filter((s) => s.receiptId === receipt.id).sort((a, b) => a.index - b.index);
        if (!(await this.uploadReceipt(receipt, mine))) break;
        // Efter varje kvitto: låt vyn se framdriften i stället för att vänta på slutet.
        await this.refresh();
      }
    } catch {
      // Ett avbrott är ett normaltillstånd i den här kön, inte ett fel att visa.
    } finally {
      this.state.update((s) => ({ ...s, uploading: false }));
      await this.refresh();
    }
  }

  /**
   * Ett svar servern gett måste delas i tre, inte två. Ett nätverksfel eller en 5xx
   * går över av sig själv och ska försökas igen. Ett 4xx gör det aldrig: bilden är
   * avvisad, och att fortsätta skicka den var femtonde sekund i evighet är en tyst
   * loop som ingen ser. 401 är det tredje fallet — sessionen har gått ut, kvittot är
   * oskyldigt, och kön ska bara vila tills någon loggat in igen.
   */
  private classify(status: number): 'ok' | 'retry' | 'stuck' | 'unauthorized' {
    if (status < 400) return 'ok';
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 408 || status === 429 || status >= 500) return 'retry';
    return 'stuck';
  }

  /**
   * Sessionen har gått ut. Kön vilar tills någon loggat in igen — kvittona är
   * oskyldiga och ligger kvar i telefonen. Det som saknades var beskedet: skärmen
   * fortsatte visa "Skickar" med snurra i evighet.
   */
  private utloggad(): false {
    this.state.update((s) => ({ ...s, utloggad: true, uploading: false }));
    return false;
  }

  private markStuck(id: string, status: number): void {
    this.state.update((s) => ({ ...s, stuck: [...s.stuck.filter((f) => f.id !== id), { id, ...anledning(status) }] }));
  }

  /** @returns false när nätet dog eller sessionen gått ut — då är det ingen mening att fortsätta. */
  private async uploadReceipt(receipt: QueuedReceipt, segments: QueuedSegment[]): Promise<boolean> {
    try {
      const created = await fetch('/api/receipts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: receipt.id, backlog: true }),
      });
      const createdVerdict = this.classify(created.status);
      if (createdVerdict === 'unauthorized') return this.utloggad();
      if (createdVerdict === 'stuck') {
        this.markStuck(receipt.id, created.status);
        return true;
      }
      if (createdVerdict === 'retry') return true;
      if (this.state().utloggad) this.state.update((s) => ({ ...s, utloggad: false }));

      for (const segment of segments) {
        if (this.slangda.has(receipt.id)) return true;
        const form = new FormData();
        // Kameravärdena måste ligga före filen: fälten läses i den ordning de kommer.
        form.append('capture', JSON.stringify(segment.capture));
        form.append('file', new Blob([segment.bytes], { type: 'image/jpeg' }), `segment-${segment.index}.jpg`);
        const response = await fetch(`/api/receipts/${receipt.id}/segments/${segment.index}`, {
          method: 'POST',
          body: form,
        });
        const verdict = this.classify(response.status);
        if (verdict === 'unauthorized') return this.utloggad();
        if (verdict === 'stuck') {
          // 409 är samma nummer med annat innehåll; 415 är en bild servern inte kan
          // läsa. Skälet följer med märkningen, för de två har olika vägar ut.
          this.markStuck(receipt.id, response.status);
          return true;
        }
        if (verdict === 'retry') return true;

        const saved = (await response.json().catch(() => ({}))) as { sha256?: string };
        // Kvittensen: samma bytes, inte bara ett lyckat anrop. Stämmer den inte är
        // det inget som löser sig av att försöka igen — samma bytes ger samma svar.
        // Kvittot märks som fastnat i stället för att skickas om för alltid.
        if (saved.sha256 !== segment.sha256) {
          this.markStuck(receipt.id, 0);
          return true;
        }
        await deleteSegment(segment.key);
      }

      if (receipt.segments !== null && !this.slangda.has(receipt.id)) {
        const done = await fetch(`/api/receipts/${receipt.id}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ segments: receipt.segments }),
        });
        const verdict = this.classify(done.status);
        if (verdict === 'unauthorized') return this.utloggad();
        if (verdict === 'stuck') this.markStuck(receipt.id, done.status);
        if (verdict === 'ok') {
          await deleteReceipt(receipt.id);
          const n = readToday() + 1;
          writeToday(n);
          this.state.update((s) => ({ ...s, archivedToday: n, stuck: s.stuck.filter((f) => f.id !== receipt.id) }));
        }
      }
      return true;
    } catch {
      // Nätverksfel: kön ligger kvar, och nästa väckning försöker igen.
      return false;
    }
  }
}
