import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MenyComponent } from '../shared/meny.component';

type Segment = { file: string; sha256: string; bytes: number; width: number; height: number };

type Receipt = {
  id: string;
  capturedAt: string;
  backlog: boolean;
  segments: Segment[];
  expectedSegments: number | null;
  completedAt: string | null;
  fields: Record<string, unknown>;
  text: string;
  tags: { user: string[]; auto: string[] };
};

/**
 * Läsvyn för ett kvitto: bilden till vänster, det vi vet om det till höger.
 *
 * Segmenten staplas kant i kant i en kolumn i stället för att ligga i flikar —
 * papperet var ett papper, och skarven mellan två bilder är något man vill kunna följa
 * med blicken. Saknas ett segment står en lucka där i stället för att bilderna sluter
 * sig runt hålet; ett kvitto med en tappad mittbit ska inte se helt ut.
 *
 * Fältpanelen står tom tills textutläsningen finns. Att rita ut butik, datum och
 * belopp med påhittade värden hade varit att bygga skärmen färdig på bekostnad av att
 * den säger sanningen.
 */
@Component({
  selector: 'app-kvitto',
  host: { 'data-density': 'comfortable' },
  imports: [RouterLink, MenyComponent],
  templateUrl: './kvitto.component.html',
  styleUrl: './kvitto.component.css',
})
export class KvittoComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly receipt = signal<Receipt | null>(null);
  readonly error = signal<string | null>(null);
  readonly visaText = signal(false);

  readonly id = computed(() => this.route.snapshot.paramMap.get('id') ?? '');

  /** Fångsten är oavslutad om klienten aldrig hann säga hur många bilder kvittot har. */
  readonly oavslutat = computed(() => this.receipt()?.completedAt === null);

  /** Bilder som utlovats men aldrig kom fram. Den viktigaste siffran på hela sidan. */
  readonly saknade = computed(() => {
    const r = this.receipt();
    if (!r || r.expectedSegments === null) return 0;
    return Math.max(0, r.expectedSegments - r.segments.length);
  });

  readonly harText = computed(() => (this.receipt()?.text ?? '').trim().length > 0);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const response = await fetch(`/api/receipts/${this.id()}`);
      if (response.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (response.status === 404) {
        this.error.set('Kvittot finns inte i arkivet.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const receipt = (await response.json()) as Receipt;
      this.receipt.set(receipt);
      // Finns text men inga fält är texten det enda som faktiskt går att visa. Att
      // gömma den bakom en knapp gjorde att tolkningen såg ut att inte ha hänt.
      if (receipt.text.trim().length > 0 && Object.keys(receipt.fields).length === 0) {
        this.visaText.set(true);
      }
    } catch {
      this.error.set('Kunde inte hämta kvittot. Är servern igång?');
    }
  }

  bild(file: string): string {
    return `/api/receipts/${this.id()}/files/${file}`;
  }

  datum(iso: string): string {
    return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  klocka(iso: string): string {
    return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  toggleText(): void {
    this.visaText.update((v) => !v);
  }
}
