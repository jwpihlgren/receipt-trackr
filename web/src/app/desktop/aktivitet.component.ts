import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TolkningService } from '../ocr/tolkning.service';
import { MenyComponent } from '../shared/meny.component';

type Lage = 'bilder' | 'ofullstandig' | 'vantar' | 'utan_text' | 'svag_text' | 'saknar_falt';

type Rad = {
  id: string;
  capturedAt: string;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  lage: Lage;
  saknadeBilder: number;
  saknadeFalt: string[];
  tecken: number;
  teckenPerRad: number | null;
};

type Aktivitet = { total: number; vantar: number; receipts: Rad[] };

/**
 * Allt som inte är färdigt, i en tabell, med läget som kolumn.
 *
 * Färdigt betyder: fångsten avslutad, alla bilder framme, tolkningen körd och
 * butik, datum och belopp lästa. Ett kvitto som klarat det står inte här. Låg
 * konfidens gör ingen rad — konfidensen mäts men beordrar ingenting.
 */
@Component({
  selector: 'app-aktivitet',
  host: { 'data-density': 'compact' },
  imports: [RouterLink, MenyComponent],
  templateUrl: './aktivitet.component.html',
  styleUrl: './aktivitet.component.css',
})
export class AktivitetComponent {
  private readonly router = inject(Router);
  readonly tolkning = inject(TolkningService);

  readonly data = signal<Aktivitet | null>(null);
  readonly error = signal<string | null>(null);

  readonly rader = computed(() => this.data()?.receipts ?? []);
  readonly vantar = computed(() => this.data()?.vantar ?? 0);
  readonly total = computed(() => this.data()?.total ?? 0);
  readonly fardiga = computed(() => Math.max(0, this.total() - this.rader().length));

  constructor() {
    void this.load();
    void this.tolkning.rakna();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const svar = await fetch('/api/aktivitet');
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      this.data.set((await svar.json()) as Aktivitet);
    } catch {
      this.error.set('Kunde inte hämta aktiviteten. Är servern igång?');
    }
  }

  async tolka(): Promise<void> {
    await this.tolkning.kor();
    await this.load();
  }

  readonly arbetar = signal(false);

  /**
   * Räknar om fälten ur texten som redan lästs, för hela arkivet. Billigt: ingen bild
   * öppnas. Det är vägen när utvinningsreglerna blivit bättre sedan kvittot tolkades.
   */
  async tolkaOmFalt(): Promise<void> {
    this.arbetar.set(true);
    try {
      const svar = await fetch('/api/falt/omtolka', { method: 'POST' });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      await this.load();
    } catch {
      this.error.set('Omtolkningen gick inte att köra.');
    } finally {
      this.arbetar.set(false);
    }
  }

  /**
   * Läser om bilden: kastar texten så att kvittot hamnar i tolkningskön igen. Dyrt,
   * och den enda vägen när det som lästes inte går att lita på.
   */
  async lasOm(id: string): Promise<void> {
    this.arbetar.set(true);
    try {
      const svar = await fetch(`/api/receipts/${id}/lasom`, { method: 'POST' });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      await this.tolkning.rakna();
      await this.load();
    } catch {
      this.error.set('Kvittot gick inte att lägga tillbaka i kön.');
    } finally {
      this.arbetar.set(false);
    }
  }

  /** Kvittot som tolkas just nu, om den här datorn är den som tolkar. */
  readonly tolkasNu = computed(() => (this.tolkning.snapshot().kor ? this.tolkning.snapshot().steg : null));

  status(rad: Rad): string {
    switch (rad.lage) {
      case 'bilder':
        return `${rad.saknadeBilder} ${rad.saknadeBilder === 1 ? 'bild' : 'bilder'} saknas`;
      case 'ofullstandig':
        return 'Fångsten avslutades inte';
      case 'vantar':
        return 'Väntar på tolkning';
      case 'utan_text':
        return 'Ingen text lästes';
      case 'svag_text':
        return 'Bilden gick knappt att läsa';
      case 'saknar_falt':
        return `Saknar ${lista(rad.saknadeFalt)}`;
    }
  }

  /** Tre grader, och var och en har både en färg och ett eget ord i statusen. */
  grad(rad: Rad): 'illa' | 'obs' | 'vantan' {
    if (rad.lage === 'bilder' || rad.lage === 'svag_text') return 'illa';
    if (rad.lage === 'vantar') return 'vantan';
    return 'obs';
  }

  butik(rad: Rad): string {
    return rad.store ?? '—';
  }

  belopp(rad: Rad): string {
    return rad.total === null ? '—' : `${rad.total.toFixed(2).replace('.', ',')} kr`;
  }

  fangat(iso: string): string {
    return new Date(iso).toLocaleString('sv-SE', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

const lista = (ord: string[]): string =>
  ord.length <= 1 ? (ord[0] ?? 'fält') : `${ord.slice(0, -1).join(', ')} och ${ord.at(-1)}`;
