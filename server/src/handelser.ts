/**
 * Vad som händer i arkivet, sänt till dem som tittar på det.
 *
 * Appen hade ingen sådan kanal alls: aktiviteten hämtade om när fönstret fick fokus,
 * menyns siffra när lådan öppnades, och telefonen frågade efter jobb var trettionde
 * sekund. Följden var att en uppladdning från telefonen syntes på datorn först när
 * någon klickade i datorns fönster.
 *
 * **Servern räknar fortfarande inte.** Den säger "det här kvittot ändrades" och inget
 * mer — vad det betyder för en lista avgör klienten, som förut. Händelsen bär därför
 * ett id och en typ, aldrig ett kvitto: en klient som får veta *vad* som står i
 * kvittot skulle sluta fråga, och då finns sanningen på två ställen.
 *
 * Bussen lever i minnet och överlever inte en omstart. Det är rätt: den som kopplar
 * upp sig hämtar sin lista först och lyssnar sedan, så en tappad händelse kostar en
 * omhämtning och ingenting annat.
 */
export type Handelse = {
  /** `kvitto` när något skrevs, `borttaget` när något raderades. */
  typ: "kvitto" | "borttaget";
  id: string;
};

export class Handelser {
  private readonly lyssnare = new Set<(h: Handelse) => void>();

  /** Returnerar avlyssningen. Den som glömmer den lämnar en läcka efter sig. */
  lyssna(fn: (h: Handelse) => void): () => void {
    this.lyssnare.add(fn);
    return () => void this.lyssnare.delete(fn);
  }

  /**
   * En trasig lyssnare får inte stoppa de andra, och får framför allt inte stoppa
   * skrivningen: `sand` anropas efter att sidecaren och indexet är på plats, och ett
   * kast här skulle göra en lyckad skrivning till ett fel.
   */
  sand(handelse: Handelse): void {
    for (const fn of [...this.lyssnare]) {
      try {
        fn(handelse);
      } catch {
        // Lyssnaren är en uppkoppling som dött. Nästa skrivning städar bort den.
      }
    }
  }

  get antal(): number {
    return this.lyssnare.size;
  }
}
