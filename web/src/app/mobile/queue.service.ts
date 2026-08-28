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
  /** Kvitton som ännu inte är helt kvitterade av servern. Det är siffran krav 3 vill ha. */
  waiting: number;
  /** Segment kvar att skicka, för den som vill veta varför det tar tid. */
  pendingSegments: number;
  uploading: boolean;
  offline: boolean;
  /** Kvitton där ett segment vägrats av servern och som behöver hanteras på datorn. */
  stuck: string[];
};

const RETRY_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly state = signal<QueueState>({
    waiting: 0,
    pendingSegments: 0,
    uploading: false,
    offline: !navigator.onLine,
    stuck: [],
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

  private async refresh(): Promise<void> {
    const [segments, receipts] = await Promise.all([allSegments(), allReceipts()]);
    this.state.update((s) => ({
      ...s,
      waiting: receipts.length,
      pendingSegments: segments.filter((seg) => !seg.confirmedAt).length,
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
      }
    } catch {
      // Ett avbrott är ett normaltillstånd i den här kön, inte ett fel att visa.
    } finally {
      this.state.update((s) => ({ ...s, uploading: false }));
      await this.refresh();
    }
  }

  /** @returns false när nätet dog — då är det ingen mening att fortsätta med nästa kvitto. */
  private async uploadReceipt(receipt: QueuedReceipt, segments: QueuedSegment[]): Promise<boolean> {
    try {
      const created = await fetch('/api/receipts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: receipt.id, backlog: true }),
      });
      if (!created.ok) return true;

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
        if (response.status === 409) {
          // Samma nummer, annat innehåll. Det får inte lösas automatiskt — bilderna
          // är oåterkalleliga, och den här ska tas om hand vid datorn.
          this.state.update((s) => ({ ...s, stuck: [...new Set([...s.stuck, receipt.id])] }));
          return true;
        }
        if (!response.ok) return true;

        const saved = (await response.json()) as { sha256?: string };
        // Kvittensen: samma bytes, inte bara ett lyckat anrop.
        if (saved.sha256 !== segment.sha256) return true;
        await deleteSegment(segment.key);
      }

      if (receipt.segments !== null) {
        const done = await fetch(`/api/receipts/${receipt.id}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ segments: receipt.segments }),
        });
        if (done.ok) await deleteReceipt(receipt.id);
      }
      return true;
    } catch {
      // Nätverksfel: kön ligger kvar, och nästa väckning försöker igen.
      return false;
    }
  }
}
