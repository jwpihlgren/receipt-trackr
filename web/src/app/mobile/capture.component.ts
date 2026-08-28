import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QueueService } from './queue.service';
import { ulid } from '../shared/ulid';
import { sha256 } from '../shared/sha256';

type Shot = { index: number; url: string; sha: string; replaced: boolean };

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
  imports: [RouterLink],
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

  /** Kvittensen efter "Klart" — det som gör att flödet har ett slut och inte bara tar slut. */
  readonly justFinished = signal<{ segments: number } | null>(null);

  /**
   * Har servern kvitterat den här bilden? Kön raderar posten först när samma sha256
   * kommit tillbaka, så frånvaro ur `pending` är svaret — inte "vi har försökt".
   */
  isConfirmed(index: number): boolean {
    return this.receiptId !== null && !this.queueState().pending.includes(`${this.receiptId}:${index}`);
  }

  /** ULID:ens tidsstämpel bestämmer katalogen på disk, så den myntas vid första bilden. */
  private receiptId: string | null = null;
  /**
   * Signal, inte ett vanligt fält: strömmen kommer en stund efter att vyn ritats, och
   * en effekt som bara läser vanliga fält körs aldrig om när de ändras. Då finns
   * kameran men syns inte — och det ser ut som att rättigheten nekats fast den gavs.
   */
  private readonly stream = signal<MediaStream | null>(null);

  constructor() {
    this.queue.start();
    void this.openCamera();
    inject(DestroyRef).onDestroy(() => {
      this.queue.stop();
      this.stream()?.getTracks().forEach((t) => t.stop());
      for (const shot of this.shots()) URL.revokeObjectURL(shot.url);
    });
    // Kopplas så snart både elementet och strömmen finns, i vilken ordning de än blir
    // klara. Strömmen stoppas aldrig mellan bilder — att starta om en kamera kostar
    // hundratals millisekunder och äter trekundersbudgeten.
    effect(() => {
      const element = this.video().nativeElement;
      const stream = this.stream();
      if (!stream || element.srcObject === stream) return;
      element.srcObject = stream;
      // Safari och flera Android-webbläsare startar inte av `autoplay` ensamt när
      // källan sätts efter att elementet ritats.
      void element.play().catch(() => this.cameraError.set('Kameran startade inte. Ladda om sidan.'));
    });
  }

  private async openCamera(): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        // Nästan alltid osäker kontext: kameran finns bara över https eller localhost.
        throw new Error('insecure');
      }
      this.stream.set(
        await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        }),
      );
      this.cameraError.set(null);
    } catch (error) {
      const name = (error as Error).name;
      this.cameraError.set(
        (error as Error).message === 'insecure'
          ? 'Kameran kräver en https-adress. Öppna sidan via tailnet-adressen, inte via IP.'
          : name === 'NotAllowedError'
            ? 'Kameran är inte tillåten. Ge sidan tillgång till kameran i webbläsarens inställningar.'
            : name === 'NotReadableError'
              ? 'Kameran är upptagen av en annan app. Stäng den och ladda om sidan.'
              : `Kameran går inte att starta (${name}).`,
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

      this.shots.update((s) => [...s, { index, url: URL.createObjectURL(blob), sha, replaced: false }]);
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

  /**
   * "Ta om" tar en **ny** bild med ett nytt nummer och märker den förra som ersatt.
   * Den gamla laddas upp ändå: bilderna är oåterkalleliga, och en bild som användaren
   * ångrat är inte samma sak som en bild som aldrig fanns. Vilken som gäller avgörs
   * vid datorn, där man ser båda.
   */
  async retake(): Promise<void> {
    const last = this.shots().at(-1);
    if (!last || this.busy()) return;
    await this.capture();
    // Bara om den nya bilden faktiskt kom i hamn — annars stod användaren kvar utan
    // användbar bild och med den gamla struken.
    if (this.shots().length > 1 && this.shots().at(-1)!.index !== last.index) {
      this.shots.update((s) => s.map((shot) => (shot.index === last.index ? { ...shot, replaced: true } : shot)));
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
    this.justFinished.set({ segments: count });
    setTimeout(() => this.justFinished.set(null), 4000);
    navigator.vibrate?.([20, 40, 20]);

    // Efter nollställningen: användaren väntar inte på skrivningen.
    await this.queue.completeReceipt(id, count);
  }

  dismissSaveError(): void {
    this.saveError.set(null);
  }
}
