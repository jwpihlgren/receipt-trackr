import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../shared/auth.service';
import { TolkningService } from '../ocr/tolkning.service';
import { MenyComponent } from '../shared/meny.component';

type Rad = {
  id: string;
  capturedAt: string;
  segments: number;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  tecken: number;
};

type Traff = { id: string; capturedAt: string; store: string | null; total: number | null; snippet: string };

type Grupp = { rubrik: string; rader: Rad[] };

/**
 * Skrivbordets startsida. En centrerad kolumn, inte tre paneler.
 *
 * Trepanelslayouten — arbetslista, bild, fältpanel — förutsätter en kö som aldrig
 * sinar. Här är kön tom nio dagar av tio, och en tom vänsterspalt som står och skäller
 * är det värsta ett stillsamt gränssnitt kan göra. Arbetslistan hör hemma i ett
 * rättningspass, som man går in i med avsikt, och den byggs när det finns fält att
 * rätta.
 */
@Component({
  selector: 'app-arkiv',
  host: { 'data-density': 'comfortable' },
  imports: [RouterLink, MenyComponent],
  templateUrl: './arkiv.component.html',
  styleUrl: './arkiv.component.css',
})
export class ArkivComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  /**
   * Tolkningen på skrivbordet startas bara av ett tryck här. Ingen schemaläggning,
   * ingen automatik: den här datorn arbetar när dess ägare säger till, och det är ett
   * uttryckligt krav och inte en inställning.
   */
  readonly tolkning = inject(TolkningService);

  readonly rader = signal<Rad[] | null>(null);
  readonly total = signal(0);
  readonly error = signal<string | null>(null);

  /**
   * Hur många kvitton som har fält ingen sett. Serverns räkning, hämtad hit bara för
   * att kön ska synas: ett rättningspass går man in i med avsikt, och en avsikt kräver
   * att man vet att det finns något att göra.
   */
  readonly attRatta = signal(0);

  readonly fraga = signal('');
  readonly traffar = signal<Traff[] | null>(null);
  readonly soker = signal(false);

  readonly grupper = computed<Grupp[]>(() => {
    const list = this.rader();
    if (!list) return [];
    const out: Grupp[] = [];
    for (const rad of list) {
      const rubrik = dagrubrik(rad.capturedAt);
      const sista = out.at(-1);
      if (sista?.rubrik === rubrik) sista.rader.push(rad);
      else out.push({ rubrik, rader: [rad] });
    }
    return out;
  });

  /** Serverns siffra, inte listans: kön kan vara längre än de hundra senaste. */
  readonly otolkade = computed(() => this.tolkning.snapshot().vantande);

  constructor() {
    void this.load();
    void this.tolkning.rakna();

    // Ett tolkat kvitto ska synas direkt, inte när passet är slut. Ett långt pass
    // annars är tio minuter där skärmen påstår att ingenting hänt.
    effect(() => {
      this.tolkning.klaraTotalt();
      void this.load();
    });
  }

  tolka(): Promise<void> {
    return this.tolkning.kor();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const response = await fetch('/api/receipts?limit=100');
      if (response.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { total: number; receipts: Rad[] };
      this.rader.set(body.receipts);
      this.total.set(body.total);
      await this.raknaAttRatta();
    } catch {
      this.error.set('Kunde inte hämta kvittona. Är servern igång?');
    }
  }

  /** Bara siffran behövs här — arbetslistan hämtas när passet börjar, inte nu. */
  private async raknaAttRatta(): Promise<void> {
    const svar = await fetch('/api/pass?limit=1');
    if (!svar.ok) return;
    this.attRatta.set(((await svar.json()) as { total: number }).total);
  }

  onFraga(event: Event): void {
    this.fraga.set((event.target as HTMLInputElement).value);
  }

  async sok(event: Event): Promise<void> {
    event.preventDefault();
    const q = this.fraga().trim();
    if (!q) return this.rensa();
    this.soker.set(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (response.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!response.ok) {
        this.traffar.set([]);
        return;
      }
      const body = (await response.json()) as { hits: Traff[] };
      this.traffar.set(body.hits);
    } catch {
      this.error.set('Sökningen gick inte att köra.');
    } finally {
      this.soker.set(false);
    }
  }

  rensa(): void {
    this.fraga.set('');
    this.traffar.set(null);
  }

  klocka(iso: string): string {
    return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  datum(iso: string): string {
    return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  async loggaUt(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/logga-in');
  }
}

function dagrubrik(iso: string): string {
  const d = new Date(iso);
  const idag = new Date();
  const igar = new Date(idag);
  igar.setDate(igar.getDate() - 1);
  if (d.toDateString() === idag.toDateString()) return 'I DAG';
  if (d.toDateString() === igar.toDateString()) return 'I GÅR';
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' }).toUpperCase();
}
