import { Injectable, signal } from '@angular/core';

/**
 * Hur många kvitton som inte är klara.
 *
 * Siffran stod förut som en egen rad överst i arkivet — på den skärm där ingenting
 * behöver göras, och borta så fort man gick någon annanstans. Den hör hemma bredvid
 * vägen till det som ska göras, alltså på Aktivitet i menyn, och därför bor den i en
 * tjänst som varje yta kan fråga.
 *
 * Frågan ställs när menyn öppnas. En klocka i bakgrunden hade räknat om en siffra som
 * ingen tittar på, och servern räknar inte åt någon som inte frågat.
 */
@Injectable({ providedIn: 'root' })
export class AktivitetService {
  private readonly state = signal(0);

  /** Antalet ofärdiga kvitton, eller noll innan någon frågat. */
  readonly antal = this.state.asReadonly();

  async hamta(): Promise<void> {
    try {
      const svar = await fetch('/api/aktivitet');
      if (!svar.ok) return;
      const { receipts } = (await svar.json()) as { receipts: unknown[] };
      this.state.set(receipts.length);
    } catch {
      // Ett tal som inte gick att hämta är inte noll. Den gamla siffran står kvar,
      // och menyn påstår hellre något gammalt än något falskt.
    }
  }

  /** Räknar ned direkt när ett kvitto blivit klart, utan att fråga servern igen. */
  minska(): void {
    this.state.update((n) => Math.max(0, n - 1));
  }
}
