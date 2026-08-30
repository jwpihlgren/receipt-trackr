import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TolkningService } from '../ocr/tolkning.service';
import { MenyComponent } from '../shared/meny.component';

type Problem = {
  id: string;
  capturedAt: string;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  saknadeBilder: number;
  utanText: boolean;
  saknadeFalt: string[];
};

type Aktivitet = { pagar: { otolkade: number }; problem: Problem[] };

/**
 * Vad systemet håller på med, och vad som gått fel.
 *
 * Listan innehåller bara sådant en människa måste laga: bilder som aldrig kom fram,
 * en tolkning som gav noll text, fält som inte gick att hitta. Ett fält maskinen läst
 * är färdigt och står inte här — låg konfidens skapar ingen rad, för konfidensen mäts
 * men beordrar ingenting. Fungerar allt är sidan tom, och det är rätt läge.
 */
@Component({
  selector: 'app-aktivitet',
  host: { 'data-density': 'comfortable' },
  imports: [RouterLink, MenyComponent],
  templateUrl: './aktivitet.component.html',
  styleUrl: './aktivitet.component.css',
})
export class AktivitetComponent {
  private readonly router = inject(Router);
  readonly tolkning = inject(TolkningService);

  readonly data = signal<Aktivitet | null>(null);
  readonly error = signal<string | null>(null);

  readonly problem = computed(() => this.data()?.problem ?? []);
  readonly otolkade = computed(() => this.tolkning.snapshot().vantande);

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

  /** Ett problem i taget, med kvittots eget språk. Aldrig en kod. */
  beskriv(p: Problem): string {
    if (p.saknadeBilder > 0) {
      return `${p.saknadeBilder} ${p.saknadeBilder === 1 ? 'bild' : 'bilder'} kom aldrig fram`;
    }
    if (p.utanText) return 'Tolkningen läste ingen text';
    const f = p.saknadeFalt;
    if (f.length === 3) return 'Varken butik, datum eller belopp hittades';
    if (f.length === 2) return `${stor(f[0]!)} och ${f[1]} hittades inte`;
    if (f.length === 1) return `${stor(f[0]!)} hittades inte`;
    return 'Något saknas';
  }

  /** Saknad bild väger tyngst: papperet är slängt och bilden går inte att få igen. */
  allvarligt(p: Problem): boolean {
    return p.saknadeBilder > 0;
  }

  rubrik(p: Problem): string {
    return p.store ?? 'Okänd butik';
  }

  datum(iso: string): string {
    return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
  }
}

const stor = (ord: string): string => ord.charAt(0).toUpperCase() + ord.slice(1);
