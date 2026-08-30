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
import { allReceipts, allSegments, deleteReceipt, deleteSegment, putReceipt, putSegment, type QueuedReceipt, type QueuedSegment } from './db';

export type QueueState = {
  /** Sant när servern svarat 401 eller 403. Kön vilar då tills någon loggat in igen. */
  utloggad: boolean;
  /** Kvitton som ännu inte är helt kvitterade av servern. Det är siffran krav 3 vill ha. */
  waiting: number;
  /** Segment kvar att skicka, för den som vill veta varför det tar tid. */
  pendingSegments: number;
  uploading: boolean;
  offline: boolean;
  /** Kvitton där ett segment vägrats av servern och som behöver hanteras på datorn. */
  stuck: string[];
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

  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Passen köas efter varandra i stället för att ett pågående pass gör nya anrop till
   * tystnad. Skillnaden märks precis när det spelar roll: en bild som läggs i kön medan
   * ett pass redan rullar ska skickas nu, inte om femton sekunder — och den som väntar
   * på `drain()` ska veta att ett pass som startade efter anropet är klart.
   */
  private chain: Promise<void> = Promise.resolve();

  start(): void {
    void this.refresh();
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
      confirmedAt: null,
      createdAt: Date.now(),
    });
    await putReceipt({ id: receiptId, createdAt: Date.now(), segments: null, completedAt: null });
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
      completedAt: null,
    });
    await this.refresh();
    void this.drain();
  }

  /** "Skicka om": släpp fastnat-märkningen och kör ett pass till, på användarens ord. */
  retryStuck(): Promise<void> {
    this.state.update((s) => ({ ...s, stuck: [] }));
    return this.drain();
  }

  private async refresh(): Promise<void> {
    const [segments, receipts] = await Promise.all([allSegments(), allReceipts()]);
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

  private markStuck(id: string): void {
    this.state.update((s) => ({ ...s, stuck: [...new Set([...s.stuck, id])] }));
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
        this.markStuck(receipt.id);
        return true;
      }
      if (createdVerdict === 'retry') return true;
      if (this.state().utloggad) this.state.update((s) => ({ ...s, utloggad: false }));

      for (const segment of segments) {
        if (segment.confirmedAt) continue;
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
          // läsa. Ingetdera löser sig av sig självt, och båda ska tas om hand vid
          // datorn i stället för att försökas igen för alltid.
          this.markStuck(receipt.id);
          return true;
        }
        if (verdict === 'retry') return true;

        const saved = (await response.json().catch(() => ({}))) as { sha256?: string };
        // Kvittensen: samma bytes, inte bara ett lyckat anrop. Stämmer den inte är
        // det inget som löser sig av att försöka igen — samma bytes ger samma svar.
        // Kvittot märks som fastnat i stället för att skickas om för alltid.
        if (saved.sha256 !== segment.sha256) {
          this.markStuck(receipt.id);
          return true;
        }
        await deleteSegment(segment.key);
      }

      if (receipt.segments !== null) {
        const done = await fetch(`/api/receipts/${receipt.id}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ segments: receipt.segments }),
        });
        const verdict = this.classify(done.status);
        if (verdict === 'unauthorized') return this.utloggad();
        if (verdict === 'stuck') this.markStuck(receipt.id);
        if (verdict === 'ok') {
          await deleteReceipt(receipt.id);
          const n = readToday() + 1;
          writeToday(n);
          this.state.update((s) => ({ ...s, archivedToday: n, stuck: s.stuck.filter((x) => x !== receipt.id) }));
        }
      }
      return true;
    } catch {
      // Nätverksfel: kön ligger kvar, och nästa väckning försöker igen.
      return false;
    }
  }
}
