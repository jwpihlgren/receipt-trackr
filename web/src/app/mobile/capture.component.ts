import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { QueueService } from './queue.service';
import { ulid } from '../shared/ulid';
import { sha256 } from '../shared/sha256';

type Shot = { index: number; url: string; sha: string };

/**
 * Mobilläget (krav 1, 2, 3, 5, 7, 42, 43). Ett syfte: få in kvittot, stående, med en
 * hand, och släppa det.
 *
 * Ordningen i `capture()` är hela milstolpen. Bilden skrivs till disk **innan** den
 * visas i remsan, därför att en bild som syns men inte ligger kvar efter en krasch är
 * precis den tysta förlusten arkivet finns för att förhindra. Uppladdningen ligger
 * däremot aldrig i vägen: den startar och användaren går vidare.
 *
 * Autoutlösningen (krav 6) hör till M8. Här finns bara den manuella avtryckaren, som
 * enligt krav 7 alltid ska finnas kvar oavsett vad som byggs ovanpå.
 */
@Component({
  selector: 'app-capture',
  host: { 'data-density': 'comfortable' },
  imports: [],
  templateUrl: './capture.component.html',
  styleUrl: './capture.component.css',
})
export class CaptureComponent {
  private readonly queue = inject(QueueService);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  readonly shots = signal<Shot[]>([]);
  readonly cameraError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly queueState = this.queue.snapshot;
  readonly hasShots = computed(() => this.shots().length > 0);

  /** ULID:ens tidsstämpel bestämmer katalogen på disk, så den myntas vid första bilden. */
  private receiptId: string | null = null;
  private stream: MediaStream | null = null;

  constructor() {
    this.queue.start();
    void this.openCamera();
    inject(DestroyRef).onDestroy(() => {
      this.queue.stop();
      this.stream?.getTracks().forEach((t) => t.stop());
      for (const shot of this.shots()) URL.revokeObjectURL(shot.url);
    });
    // Strömmen kopplas när elementet finns; den stoppas aldrig mellan bilder — att
    // starta om en kamera kostar hundratals millisekunder och äter trekundersbudgeten.
    effect(() => {
      const element = this.video().nativeElement;
      if (this.stream && element.srcObject !== this.stream) element.srcObject = this.stream;
    });
  }

  private async openCamera(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      this.cameraError.set(null);
    } catch (error) {
      this.cameraError.set(
        (error as Error).name === 'NotAllowedError'
          ? 'Kameran är inte tillåten. Ge sidan tillgång till kameran i webbläsarens inställningar.'
          : 'Kameran går inte att starta. Är den upptagen av en annan app?',
      );
    }
  }

  /**
   * Kritiska vägen. Allt tungt sker här, vid varje bild — inte vid "Klart". Det gör
   * att avslutet blir en liten skrivning i stället för hela kvittots arbete, och
   * krymper förlustfönstret från kvittots längd till ett ögonblick.
   */
  async capture(): Promise<void> {
    if (this.busy() || this.cameraError()) return;
    this.busy.set(true);
    try {
      const element = this.video().nativeElement;
      const canvas = document.createElement('canvas');
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      canvas.getContext('2d')!.drawImage(element, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Bilden gick inte att koda.');

      const bytes = await blob.arrayBuffer();
      const sha = await sha256(bytes);
      this.receiptId ??= ulid();
      const index = this.shots().length + 1;

      // Först disk, sedan skärm. Aldrig tvärtom.
      await this.queue.enqueueSegment(this.receiptId, index, bytes, sha, {
        width: canvas.width,
        height: canvas.height,
        autoShutter: false,
        takenAt: new Date().toISOString(),
      });

      this.shots.update((s) => [...s, { index, url: URL.createObjectURL(blob), sha }]);
      this.saveError.set(null);
      navigator.vibrate?.(20);
    } catch (error) {
      // Det enda blockerande felet i hela mobilläget: bilden kunde inte sparas lokalt.
      this.saveError.set(
        `Bilden kunde inte sparas i telefonen: ${(error as Error).message} ` +
          'Ta inte bort kvittot — försök igen, eller frigör utrymme först.',
      );
      navigator.vibrate?.([40, 60, 40]);
    } finally {
      this.busy.set(false);
    }
  }

  /** "Klart": antalet bilder blir känt, och kameran är omedelbart redo för nästa kvitto. */
  async done(): Promise<void> {
    const id = this.receiptId;
    const count = this.shots().length;
    if (!id || count === 0) return;

    for (const shot of this.shots()) URL.revokeObjectURL(shot.url);
    this.shots.set([]);
    this.receiptId = null;
    navigator.vibrate?.([20, 40, 20]);

    // Efter nollställningen: användaren väntar inte på skrivningen.
    await this.queue.completeReceipt(id, count);
  }

  dismissSaveError(): void {
    this.saveError.set(null);
  }
}
