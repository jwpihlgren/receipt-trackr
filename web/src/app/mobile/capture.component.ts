import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CaptureFlowService } from './capture-flow.service';
import { QueueService } from './queue.service';

type Steg = 'granska' | 'borjahar' | 'sparat';

/**
 * Granskningen av en tagen bild, och avslutet.
 *
 * Fotograferingen sker inte här — den sker i telefonens egen kameraapp, som är en
 * skärm vi varken äger eller kan lägga något ovanpå. Därför finns ingen sökare, ingen
 * avtryckare och ingen autoutlösare i den här komponenten. Det som finns är det enda
 * ögonblick appen faktiskt har: bilden i handen, med användaren fortfarande kvar vid
 * kvittot.
 *
 * "Börja här" är skuggremsans arvtagare. Som sikte över livebilden är den död, men
 * dess funktion — att veta var nästa bild ska börja — flyttar till *före* avfärden,
 * som ett minne man bär med sig in i kameraappen.
 */
@Component({
  selector: 'app-capture',
  host: { 'data-density': 'comfortable' },
  imports: [],
  templateUrl: './capture.component.html',
  styleUrl: './capture.component.css',
})
export class CaptureComponent {
  private readonly router = inject(Router);
  private readonly queue = inject(QueueService);
  readonly flow = inject(CaptureFlowService);

  readonly steg = signal<Steg>('granska');
  readonly sparatId = signal<string | null>(null);
  readonly sparadeBilder = signal<{ index: number; url: string }[]>([]);
  readonly queueState = this.queue.snapshot;

  readonly shots = this.flow.shots;
  readonly sista = computed(() => this.shots().at(-1) ?? null);
  readonly antal = computed(() => this.shots().length);

  /**
   * Var är det sparade kvittot? Bocken sätts först när varje bild kvitterats med rätt
   * sha256 — annars kan ett halvt kvitto se helt ut.
   */
  readonly sparatStatus = computed<{ text: string; klar: boolean; illa: boolean }>(() => {
    const id = this.sparatId();
    const state = this.queueState();
    if (!id) return { text: '', klar: false, illa: false };
    if (state.stuck.includes(id)) return { text: 'Kom inte fram', klar: false, illa: true };
    if (!state.receipts.includes(id)) return { text: 'I arkivet', klar: true, illa: false };
    if (state.offline) return { text: 'Sparat i telefonen · väntar på nät', klar: false, illa: false };
    const kvar = state.pending.filter((k) => k.startsWith(`${id}:`)).length;
    const total = this.sparadeBilder().length;
    if (kvar === 0) return { text: 'På väg till arkivet', klar: false, illa: false };
    return { text: `Skickar bild ${total - kvar + 1} av ${total}`, klar: false, illa: false };
  });

  constructor() {
    this.queue.start();
    // Direktnavigering hit utan påbörjad fångst har ingenting att visa.
    if (this.flow.shots().length === 0) void this.router.navigateByUrl('/telefon/kvitton');
  }

  isConfirmed(index: number): boolean {
    return this.flow.isConfirmed(index);
  }

  /** "Kvittot fortsätter": visa var nästa bild ska börja, innan kameran öppnas. */
  fortsatt(): void {
    this.steg.set('borjahar');
  }

  openCamera(): void {
    this.flow.markAwaiting();
  }

  /** Samma input används för att ta om en bild och för att lägga till nästa del. */
  async onFile(event: Event, omtagning = false): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      this.flow.cancelAwaiting();
      return;
    }
    if (await this.flow.accept(file)) {
      if (omtagning) this.flow.markLastReplaced();
      this.steg.set('granska');
    }
  }

  async spara(): Promise<void> {
    const bilder = this.shots().map((s) => ({ index: s.index, url: s.url }));
    const id = await this.flow.save();
    if (!id) return;
    this.sparadeBilder.set(bilder);
    this.sparatId.set(id);
    this.steg.set('sparat');
  }

  /** "Fotografera nästa kvitto" — kortet släpps och kameran öppnas för ett nytt id. */
  nastaKvitto(): void {
    this.slappKort();
    this.flow.markAwaiting();
  }

  async fardig(): Promise<void> {
    this.slappKort();
    await this.router.navigateByUrl('/telefon/kvitton');
  }

  async avbryt(): Promise<void> {
    // Bilderna ligger kvar i kön och laddas upp ändå — de är oåterkalleliga.
    this.flow.reset();
    await this.router.navigateByUrl('/telefon/kvitton');
  }

  private slappKort(): void {
    for (const bild of this.sparadeBilder()) URL.revokeObjectURL(bild.url);
    this.sparadeBilder.set([]);
    this.sparatId.set(null);
    this.steg.set('granska');
  }
}
