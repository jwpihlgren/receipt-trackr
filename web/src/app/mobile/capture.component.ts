import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
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
  /** Sant medan frågan om att kasta bilderna står på skärmen. */
  readonly fragar = signal(false);
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
    if (state.stuck.some((f) => f.id === id)) return { text: 'Kom inte fram', klar: false, illa: true };
    if (!state.receipts.includes(id)) return { text: 'I arkivet', klar: true, illa: false };
    if (state.offline) return { text: 'Sparat i telefonen · väntar på nät', klar: false, illa: false };
    const kvar = state.pending.filter((k) => k.startsWith(`${id}:`)).length;
    const total = this.sparadeBilder().length;
    if (kvar === 0) return { text: 'På väg till arkivet', klar: false, illa: false };
    return { text: `Skickar bild ${total - kvar + 1} av ${total}`, klar: false, illa: false };
  });

  private readonly fragan = viewChild<ElementRef<HTMLDialogElement>>('fraga');

  constructor() {
    this.queue.start();
    // Direktnavigering hit utan påbörjad fångst har ingenting att visa.
    if (this.flow.shots().length === 0) void this.router.navigateByUrl('/telefon/kvitton');

    // Signalen är sanningen; <dialog> är bara det som visar den. `showModal()` är
    // enda vägen till Esc, fokusfälla och inert bakgrund — attributet `open` ger
    // ingetdera.
    effect(() => {
      const el = this.fragan()?.nativeElement;
      if (!el) return;
      if (this.fragar() && !el.open) el.showModal();
      else if (!this.fragar() && el.open) el.close();
    });
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
      // Kortet från förra kvittot släpps först nu, när en bild faktiskt kommit.
      this.slappKort();
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

  /**
   * "Fotografera nästa kvitto" — kameran öppnas för ett nytt id.
   *
   * **Kortet släpps inte här.** `slappKort()` satte steget till `granska`, och Angular
   * rev då bort just den `<label>` vars standardåtgärd — att öppna kameran — ännu inte
   * hade utförts. Signalen hann fram, så överlägget "Kameran är öppen" kom upp, men
   * ingen kamera: första bilden på varje kvitto togs aldrig. Kortet släpps i `onFile`,
   * när en bild faktiskt kommit tillbaka.
   *
   * Följdvinst: backar man ur kameran står "Kvittot är sparat" kvar, i stället för den
   * tomma granskningsvyn utan bild man landade i förut.
   */
  nastaKvitto(): void {
    this.flow.markAwaiting();
  }

  async fardig(): Promise<void> {
    this.slappKort();
    await this.router.navigateByUrl('/telefon/kvitton');
  }

  /**
   * "Avbryt" frågar först, och kastar sedan på riktigt.
   *
   * Knappen släppte tidigare bara skärmen medan kön laddade upp bilderna ändå, och
   * kvittot blev kvar i arkivet utan känt antal bilder — alltså för alltid ofärdigt.
   * Ordet lovade motsatsen till vad som hände. Nu gör det det ordet säger, men aldrig
   * på ett enda tryck: bilder som försvinner ska en människa ha sagt ja till.
   */
  avbryt(): void {
    if (this.antal() === 0) {
      void this.router.navigateByUrl('/telefon/kvitton');
      return;
    }
    this.fragar.set(true);
  }

  angraAvbryt(): void {
    this.fragar.set(false);
  }

  async kasta(): Promise<void> {
    this.fragar.set(false);
    // Skärmen släpps med en gång. Raderingen fortsätter i tjänsten — den som tryckt
    // ska inte stå kvar och titta på en dialog medan en serverradering går fram.
    const klart = this.flow.discard();
    await this.router.navigateByUrl('/telefon/kvitton');
    await klart;
  }

  private slappKort(): void {
    for (const bild of this.sparadeBilder()) URL.revokeObjectURL(bild.url);
    this.sparadeBilder.set([]);
    this.sparatId.set(null);
    this.steg.set('granska');
  }
}
