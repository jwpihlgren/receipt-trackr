/**
 * Fångsten av ett kvitto, från bildfil till kö.
 *
 * Tjänsten finns därför att flödet numera går över två rutter: listan öppnar
 * telefonens kamera, och granskningen ligger på /fanga. Bilden kommer alltså in på
 * en skärm och visas på en annan, och det som håller ihop dem får inte vara en
 * komponent som rivs vid navigeringen.
 *
 * Ordningen i `accept()` är hela poängen: bytesen skrivs till disk **innan** bilden
 * visas. En bild som syns men inte ligger kvar efter en krasch är precis den tysta
 * förlusten arkivet finns för att förhindra.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { QueueService } from './queue.service';
import { ulid } from '../shared/ulid';
import { sha256 } from '../shared/sha256';

export type Shot = {
  index: number;
  url: string;
  sha: string;
  replaced: boolean;
  /** Nederkanten av bilden, som skuggremsa inför nästa del. */
  slut: string | null;
};

/** Hur stor del av föregående bilds nederkant som visas som "Börja här". */
const OVERLAP = 0.2;

/** Telefonens kamera ger 12 megapixel; taket i servern är 32 MiB per segment. */
const JPEG_QUALITY = 0.92;

@Injectable({ providedIn: 'root' })
export class CaptureFlowService {
  private readonly queue = inject(QueueService);

  readonly shots = signal<Shot[]>([]);
  /** Sant mellan trycket på knappen och att en fil kommer tillbaka — eller inte. */
  readonly awaiting = signal(false);
  readonly busy = signal(false);
  readonly saveError = signal<string | null>(null);
  /** Bilden gick inte att avkoda här, men bytesen är sparade. Inte ett fel att stoppa på. */
  readonly previewWarning = signal<string | null>(null);

  readonly hasShots = computed(() => this.shots().length > 0);
  readonly ghost = computed(() => this.shots().at(-1)?.slut ?? null);

  private receiptId: string | null = null;

  /** Knappen trycktes. Skärmen ska nu säga att kameran är öppen. */
  markAwaiting(): void {
    this.awaiting.set(true);
    this.saveError.set(null);
  }

  /**
   * Användaren backade ur kameraappen. Det är ett val, inte ett fel — ingen dialog,
   * ingen röd ruta. Skärmen går bara tillbaka till det den visade.
   */
  cancelAwaiting(): void {
    this.awaiting.set(false);
  }

  /**
   * Tar emot en fil från telefonens kamera eller galleri. Returnerar sant när bytesen
   * ligger på disk — först då får bilden visas.
   */
  async accept(file: File): Promise<boolean> {
    this.awaiting.set(false);
    if (this.busy()) return false;
    this.busy.set(true);
    this.previewWarning.set(null);
    try {
      const { bytes, blob, width, height, converted } = await normalise(file);
      const sha = await sha256(bytes);
      this.receiptId ??= ulid();
      const index = this.shots().length + 1;

      // Först disk, sedan skärm. Aldrig tvärtom.
      await this.queue.enqueueSegment(this.receiptId, index, bytes, sha, {
        ...(width && height ? { width, height } : {}),
        autoShutter: false,
        source: 'systemkamera',
        ...(converted ? { converted: 'jpeg' } : {}),
        takenAt: new Date(file.lastModified || Date.now()).toISOString(),
      });

      this.shots.update((s) => [
        ...s,
        { index, url: URL.createObjectURL(blob), sha, replaced: false, slut: null },
      ]);
      // Skuggremsan klipps efter att bilden ligger säkert — den är en trevlighet.
      void this.cutGhost(index, blob);
      this.saveError.set(null);
      navigator.vibrate?.(20);
      return true;
    } catch (error) {
      this.saveError.set(
        `Bilden kunde inte sparas i telefonen: ${(error as Error).message} ` +
          'Ta inte bort kvittot — försök igen, eller frigör utrymme först.',
      );
      navigator.vibrate?.([40, 60, 40]);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * "Ta om" märker den förra bilden som ersatt men laddar upp den ändå. Bilderna är
   * oåterkalleliga, och en bild användaren ångrat är inte samma sak som en som aldrig
   * fanns. Vilken som gäller avgörs vid datorn, där man ser båda.
   */
  markLastReplaced(): void {
    const shots = this.shots();
    if (shots.length < 2) return;
    const previous = shots.at(-2)!;
    this.shots.update((s) => s.map((shot) => (shot.index === previous.index ? { ...shot, replaced: true } : shot)));
  }

  /** "Spara kvittot": antalet bilder blir känt och fångsten är över. */
  async save(): Promise<string | null> {
    const id = this.receiptId;
    const count = this.shots().filter((s) => !s.replaced).length || this.shots().length;
    if (!id || this.shots().length === 0) return null;
    const total = this.shots().length;
    this.reset(false);
    navigator.vibrate?.([20, 40, 20]);
    // Efter nollställningen: användaren väntar inte på skrivningen.
    await this.queue.completeReceipt(id, total);
    void count;
    return id;
  }

  /** Släpper fångsten utan att spara. Bilderna ligger kvar i kön och laddas upp ändå. */
  reset(revoke = true): void {
    if (revoke) for (const shot of this.shots()) URL.revokeObjectURL(shot.url);
    this.shots.set([]);
    this.receiptId = null;
    this.awaiting.set(false);
    this.saveError.set(null);
    this.previewWarning.set(null);
  }

  dismissSaveError(): void {
    this.saveError.set(null);
  }

  /** Har servern kvitterat den här bilden med samma sha256? */
  isConfirmed(index: number): boolean {
    return this.receiptId !== null && !this.queue.snapshot().pending.includes(`${this.receiptId}:${index}`);
  }

  private async cutGhost(index: number, blob: Blob): Promise<void> {
    try {
      const bitmap = await createImageBitmap(blob);
      const height = Math.round(bitmap.height * OVERLAP);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = height;
      canvas
        .getContext('2d')!
        .drawImage(bitmap, 0, bitmap.height - height, bitmap.width, height, 0, 0, bitmap.width, height);
      bitmap.close();
      const strip = canvas.toDataURL('image/jpeg', 0.7);
      this.shots.update((s) => s.map((shot) => (shot.index === index ? { ...shot, slut: strip } : shot)));
    } catch {
      // Utan remsa fungerar flödet ändå — man får bara ingen hjälp med skarven.
    }
  }
}

type Normalised = { bytes: ArrayBuffer; blob: Blob; width: number; height: number; converted: boolean };

/**
 * Telefonens kamera lämnar ifrån sig JPEG på Android och kan lämna HEIC på iPhone.
 * `sharp` på servern läser inte HEIF, så en HEIC-fil hade avvisats med 415 — därför
 * kodas allt som inte redan är JPEG om här, med bilden upprätt.
 *
 * Att koda om bakar också in EXIF-orienteringen i pixlarna. Mätserien i M0 visade att
 * 91 % av bilderna saknade orienteringstagg helt och att riktningen då måste gissas
 * ur innehållet; en upprätt bild tar bort hela den felklassen innan den uppstår.
 */
async function normalise(file: File): Promise<Normalised> {
  const original = await file.arrayBuffer();

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Webbläsaren kan inte avkoda filen. Bytesen är fortfarande giltiga att arkivera.
    return { bytes: original, blob: file, width: 0, height: 0, converted: false };
  }

  const { width, height } = bitmap;
  if (file.type === 'image/jpeg') {
    bitmap.close();
    return { bytes: original, blob: file, width, height, converted: false };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();

  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!jpeg) return { bytes: original, blob: file, width, height, converted: false };
  return { bytes: await jpeg.arrayBuffer(), blob: jpeg, width, height, converted: true };
}
