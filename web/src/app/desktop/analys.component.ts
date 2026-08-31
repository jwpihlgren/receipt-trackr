import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MenyComponent } from '../shared/meny.component';

type Del = { kategori: string; summa: number; antal: number };
type Manad = { manad: string; summa: number; antal: number; delar: Del[] };
type Kategori = Del & { forra: number | null };

type Svar = {
  fran: string;
  till: string;
  summa: number;
  antal: number;
  manader: Manad[];
  kategorier: Kategori[];
  storsta: { id: string; store: string | null; date: string | null; total: number | null; kategori: string | null }[];
  kategorier_ordning: string[];
};

/** Plotens höjd i pixlar. Staplarna räknas mot den, inte mot en procentsats. */
const PLOT = 264;

/** Kategorin som är frånvaron av en kategori. Den får grått, aldrig ett av slagen. */
const OVRIGT = 'Övrigt';

/**
 * Analysen: vart pengarna gick.
 *
 * Formen följer intervjun. Beställaren ville ha tre saker och tänker i månader:
 * fördelningen, om något sticker ut, och utvecklingen över tid. Därför en stapel per
 * månad med kategorierna staplade i sig — samma bild svarar på alla tre — plus
 * fördelningen som lista och de största köpen med vägen tillbaka till kvittot.
 *
 * **Ett köp räknas en gång.** Servern räknar bort dubbletterna innan summan görs; tre
 * foton av samma kvitto är inte tre utgifter, och det felet syns aldrig i en summa.
 */
@Component({
  selector: 'app-analys',
  imports: [RouterLink, MenyComponent],
  templateUrl: './analys.component.html',
})
export class AnalysComponent {
  private readonly router = inject(Router);

  readonly data = signal<Svar | null>(null);
  readonly laddar = signal(false);
  readonly error = signal<string | null>(null);

  readonly fran = signal(standardFran());
  readonly till = signal(idag());

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.laddar.set(true);
    this.error.set(null);
    try {
      const svar = await fetch(`/api/analys?fran=${this.fran()}&till=${this.till()}`);
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      this.data.set((await svar.json()) as Svar);
    } catch {
      this.error.set('Analysen gick inte att hämta.');
    } finally {
      this.laddar.set(false);
    }
  }

  onFran(event: Event): void {
    this.fran.set((event.target as HTMLInputElement).value);
    void this.load();
  }

  onTill(event: Event): void {
    this.till.set((event.target as HTMLInputElement).value);
    void this.load();
  }

  readonly tomt = computed(() => (this.data()?.antal ?? 0) === 0);

  /**
   * Skalans topp: ett jämnt tal ovanför den största månaden, så att rutnätets linjer
   * går att läsa som tusental i stället för som en tredjedel av något.
   */
  readonly topp = computed(() => {
    const storsta = Math.max(0, ...(this.data()?.manader ?? []).map((m) => m.summa));
    if (storsta === 0) return 1000;
    const steg = Math.pow(10, Math.floor(Math.log10(storsta))) / 2;
    return Math.ceil(storsta / steg) * steg;
  });

  /** Rutnätets fyra linjer, uppifrån och ned. */
  readonly linjer = computed(() => {
    const topp = this.topp();
    return [topp, (topp / 4) * 3, topp / 2, topp / 4, 0];
  });

  hojd(belopp: number): number {
    const topp = this.topp();
    // Ett hårstrå räcker för att en liten månad ska synas som något alls.
    return topp > 0 ? Math.max(2, Math.round((belopp / topp) * PLOT)) : 0;
  }

  andel(summa: number): number {
    const total = this.data()?.summa ?? 0;
    return total > 0 ? Math.round((summa / total) * 100) : 0;
  }

  /**
   * Färgen följer kategorins plats i den ordning arkivet håller — aldrig dess storlek.
   * En kategori som växer byter inte färg, och ett filter målar inte om de andra.
   */
  farg(kategori: string | null): string {
    if (!kategori || kategori === OVRIGT) return 'var(--kategori-ovrig)';
    const plats = (this.data()?.kategorier_ordning ?? []).indexOf(kategori);
    return plats < 0 ? 'var(--kategori-ovrig)' : `var(--kategori-${(plats % 6) + 1})`;
  }

  /** "2026-04" → "april". Månadens namn räcker; året står i perioden. */
  manadsnamn(manad: string): string {
    const [ar, nr] = manad.split('-');
    return new Date(Date.UTC(Number(ar), Number(nr) - 1, 1)).toLocaleDateString('sv-SE', { month: 'long' });
  }

  belopp(varde: number | null): string {
    return varde === null ? '—' : varde.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Heltal utan ören: staplarnas etiketter ska läsas i ögonvrån, inte räknas. */
  hela(varde: number): string {
    return Math.round(varde).toLocaleString('sv-SE');
  }

  /**
   * Skillnaden mot föregående period, i ord och tal. `null` betyder att perioden före
   * är tom — arkivet når inte så långt bak — och det är något annat än noll.
   */
  forandring(rad: Kategori): string | null {
    if (rad.forra === null) return null;
    if (rad.forra === 0) return 'ny sedan förra perioden';
    const andel = Math.round(((rad.summa - rad.forra) / rad.forra) * 100);
    if (andel === 0) return 'som förra perioden';
    return `${andel > 0 ? '+' : ''}${andel} % mot förra perioden`;
  }
}

function idag(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Tolv månader bakåt, från den första i månaden. Perioden beställaren tänker i. */
function standardFran(): string {
  const nu = new Date();
  return new Date(Date.UTC(nu.getUTCFullYear() - 1, nu.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
