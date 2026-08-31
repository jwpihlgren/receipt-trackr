import { Injectable, signal } from '@angular/core';

export type Handelse = { typ: 'kvitto' | 'borttaget'; id: string };

/**
 * Strömmen från servern: vad som ändrats i arkivet, medan man tittar på det.
 *
 * Appen var inte reaktiv alls. Aktiviteten hämtade om när fönstret fick fokus, menyns
 * siffra när lådan öppnades, och telefonen frågade efter jobb var trettionde sekund —
 * så en uppladdning från telefonen syntes på datorn först när någon klickade i datorns
 * fönster. Nu säger servern till.
 *
 * **Uppkopplingen är räknad.** Den öppnas när första vyn börjar följa och stängs när
 * den sista slutar. En ström som öppnas i en konstruktor och aldrig stängs är samma fel
 * som pulslyssnaren i tolkningstjänsten en gång var, och den här lever i roten.
 *
 * Händelsen bär bara typ och id. Vad den betyder för en lista avgör vyn, genom att
 * fråga om sin lista — servern räknar inte, och en klient som fick kvittot i strömmen
 * skulle ha sanningen på två ställen.
 */
@Injectable({ providedIn: 'root' })
export class HandelserService {
  private kalla: EventSource | null = null;
  private readonly foljare = new Set<(h: Handelse | null) => void>();
  /** Sant sedan strömmen tappat, tills följarna väckts igen. */
  private harVaritNere = false;

  /**
   * Sant när strömmen är öppen.
   *
   * Ingen vy visar den, och den är inte till för att visas: den avgör om en
   * uppkoppling är en **återanslutning**, och det är skillnaden mellan att veta att man
   * är aktuell och att bara tro det.
   */
  readonly ansluten = signal(false);

  /**
   * Börjar följa strömmen. Returnerar avlyssningen, som **måste** anropas — knyt den
   * till komponentens `DestroyRef`.
   *
   * Återanropet får `null` när strömmen återanslutit efter ett avbrott: då vet ingen
   * vad som hänt under tiden, och det enda rätta svaret är att hämta om allt. Vyerna
   * gör redan det oavsett argument, och det är därför argumentet inte används någonstans
   * — det står där för den som en dag vill titta på `id`.
   */
  folj(fn: (h: Handelse | null) => void): () => void {
    this.foljare.add(fn);
    this.oppna();
    return () => {
      this.foljare.delete(fn);
      if (this.foljare.size === 0) this.stang();
    };
  }

  private oppna(): void {
    if (this.kalla) return;
    const kalla = new EventSource('/api/handelser');
    this.kalla = kalla;
    /**
     * Vid en **återanslutning** väcks alla följare, utan att någon händelse kommit.
     *
     * Allt som hände medan strömmen låg nere gick förlorat — bussen lever i minnet och
     * spelar inte upp något i efterhand. Utan det här stod listorna kvar som de såg ut
     * när nätet försvann och påstod att de var aktuella, vilket är värre än att inte ha
     * någon ström alls: fokuslyssnaren är en reserv man måste råka utlösa.
     */
    kalla.onopen = () => {
      const aterkom = !this.ansluten();
      this.ansluten.set(true);
      if (aterkom && this.harVaritNere) {
        this.harVaritNere = false;
        for (const fn of [...this.foljare]) fn(null);
      }
    };
    kalla.onmessage = (e) => {
      let handelse: Handelse;
      try {
        handelse = JSON.parse(e.data) as Handelse;
      } catch {
        // Skräp i strömmen är inte värt att krascha på. Nästa händelse duger.
        return;
      }
      for (const fn of [...this.foljare]) fn(handelse);
    };
    /**
     * Webbläsaren återansluter själv, med sin egen backoff. Det enda som behövs här är
     * att sluta påstå att strömmen är öppen — en vy som tror att den får veta när något
     * ändras slutar hämta om, och det är värre än att inte ha någon ström.
     */
    kalla.onerror = () => {
      this.ansluten.set(false);
      this.harVaritNere = true;
    };
  }

  private stang(): void {
    this.kalla?.close();
    this.kalla = null;
    this.ansluten.set(false);
  }
}
