/**
 * Reservationer på tolkningsjobb.
 *
 * Två saker bär hela filen.
 *
 * **Servern räknar inte.** Den delar ut och tar emot; den bestämmer aldrig att en
 * maskin ska arbeta. Vilken klient som frågar efter jobb, och när, är klientens sak —
 * telefonen frågar av sig själv medan appen är öppen, datorn frågar bara när någon
 * trycker på knappen där. Den skillnaden får aldrig flytta in hit.
 *
 * **Reservationer lever i minnet, aldrig på disk.** De är det enda i systemet som inte
 * är sanning: en reservation som överlever en omstart är en reservation som ingen
 * kommer tillbaka för, och jobbet vore låst tills någon manuellt städade. Startar
 * servern om blir allt ledigt igen, vilket är exakt rätt.
 */

export type Reservation = { arbetare: string; till: number };

/** Fem minuter. Ett kvitto på åtta bilder tar tjugo sekunder; resten är marginal för
 *  en telefon som läggs i fickan mitt i. */
export const RESERVATION_MS = 5 * 60 * 1000;

export class Reservationer {
  private readonly aktiva = new Map<string, Reservation>();

  constructor(private readonly livslangdMs = RESERVATION_MS) {}

  /**
   * Soparen. Den körs vid varje anrop i stället för på en timer: en timer är en
   * rörlig del till som ska startas, stoppas och testas, och den enda vinsten vore
   * att ett jobb blir ledigt några sekunder tidigare när ingen ändå frågar efter det.
   */
  sopa(nu = Date.now()): string[] {
    const utgangna: string[] = [];
    for (const [id, res] of this.aktiva) {
      if (res.till <= nu) {
        this.aktiva.delete(id);
        utgangna.push(id);
      }
    }
    return utgangna;
  }

  /** Reserverar de id:n som är lediga och svarar med vilka det blev. */
  reservera(ids: string[], arbetare: string, nu = Date.now()): { id: string; till: number }[] {
    this.sopa(nu);
    const givna: { id: string; till: number }[] = [];
    for (const id of ids) {
      if (this.aktiva.has(id)) continue;
      const till = nu + this.livslangdMs;
      this.aktiva.set(id, { arbetare, till });
      givna.push({ id, till });
    }
    return givna;
  }

  /**
   * Lämnar tillbaka ett jobb. Bara den som håller reservationen får göra det — annars
   * kan en klient som kommit efter rycka undan ett jobb som någon annan arbetar på.
   */
  aterlamna(id: string, arbetare: string, nu = Date.now()): boolean {
    this.sopa(nu);
    const res = this.aktiva.get(id);
    if (!res || res.arbetare !== arbetare) return false;
    this.aktiva.delete(id);
    return true;
  }

  /** Efter ett inlämnat resultat: jobbet är gjort och reservationen har inget syfte. */
  slapp(id: string): void {
    this.aktiva.delete(id);
  }

  /**
   * Vem håller jobbet just nu? Klientens arbetarnamn, eller `null` om det är ledigt.
   *
   * Namnet bär enhetens **slag** i sin första del — `telefon-ab12`, `dator-cd34` — och
   * det är hela poängen med att svara med det: aktiviteten kunde säga "Väntar på
   * tolkning" med en knapp bredvid, medan telefonen stod och läste samma kvitto. Den
   * som läser skärmen trodde att hon behövde göra något.
   */
  hallare(id: string, nu = Date.now()): string | null {
    return this.reserverad(id, nu) ? (this.aktiva.get(id)?.arbetare ?? null) : null;
  }

  /** De slag av enheter som håller något just nu: `telefon`, `dator`, `okand`. */
  slag(nu = Date.now()): string[] {
    this.sopa(nu);
    return [...new Set([...this.aktiva.values()].map((r) => r.arbetare.split('-')[0]!))].sort();
  }

  reserverad(id: string, nu = Date.now()): boolean {
    const res = this.aktiva.get(id);
    if (!res) return false;
    if (res.till <= nu) {
      this.aktiva.delete(id);
      return false;
    }
    return true;
  }

  antal(nu = Date.now()): number {
    this.sopa(nu);
    return this.aktiva.size;
  }
}
