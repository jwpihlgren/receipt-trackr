import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MenyComponent } from '../shared/meny.component';
import { TolkningService } from '../ocr/tolkning.service';

type Segment = { file: string; sha256: string; bytes: number; width: number; height: number };

export type Falt = {
  value: string | number;
  confidence: number;
  source: 'ocr' | 'manual' | 'confirmed';
  candidates?: { value: string | number; confidence: number }[];
};

/** Fälten i den ordning de läses på ett kvitto, inte i den ordning de utvinns. */
const FALT: { namn: 'store' | 'date' | 'total'; etikett: string; sort: 'text' | 'tal' }[] = [
  { namn: 'store', etikett: 'BUTIK', sort: 'text' },
  { namn: 'date', etikett: 'DATUM', sort: 'text' },
  { namn: 'total', etikett: 'BELOPP', sort: 'tal' },
];

type Receipt = {
  id: string;
  capturedAt: string;
  backlog: boolean;
  segments: Segment[];
  expectedSegments: number | null;
  completedAt: string | null;
  fields: Record<string, Falt | undefined>;
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
  imports: [RouterLink, MenyComponent],
  templateUrl: './kvitto.component.html',
})
export class KvittoComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly tolkning = inject(TolkningService);
  readonly tolkar = signal(false);

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

  readonly falt = FALT;
  readonly utkast = signal<Record<string, string>>({ store: '', date: '', total: '' });
  readonly sparar = signal(false);
  readonly sparat = signal(false);

  varde(namn: string): Falt | undefined {
    return this.receipt()?.fields?.[namn];
  }

  /** Maskinläst och orört. Bekräftat eller rättat markeras inte — det tysta är det säkra. */
  maskinlast(namn: string): boolean {
    return this.varde(namn)?.source === 'ocr';
  }

  private text(namn: string): string {
    const f = this.varde(namn);
    if (f === undefined) return '';
    return namn === 'total' ? String(f.value).replace('.', ',') : String(f.value);
  }

  private fyllUtkast(): void {
    this.utkast.set(Object.fromEntries(FALT.map((f) => [f.namn, this.text(f.namn)])));
  }

  onUtkast(namn: string, event: Event): void {
    this.sparat.set(false);
    this.utkast.update((u) => ({ ...u, [namn]: (event.target as HTMLInputElement).value }));
  }

  valjKandidat(namn: string, value: string | number): void {
    this.sparat.set(false);
    this.utkast.update((u) => ({ ...u, [namn]: String(value).replace('.', ',') }));
  }

  /** Vad som skiljer formuläret från det som ligger i arkivet. Tomma fält hoppas över. */
  private andringar(): { namn: string; value: string | number; bekraftat: boolean }[] {
    const ut: { namn: string; value: string | number; bekraftat: boolean }[] = [];
    for (const f of FALT) {
      const skrivet = (this.utkast()[f.namn] ?? '').trim();
      if (!skrivet) continue;
      const befintligt = this.varde(f.namn);
      if (f.sort === 'tal') {
        const tal = Number(skrivet.replace(',', '.'));
        if (!Number.isFinite(tal)) continue;
        if (befintligt !== undefined && Number(befintligt.value) === tal) continue;
        ut.push({ namn: f.namn, value: tal, bekraftat: false });
      } else {
        if (befintligt !== undefined && String(befintligt.value) === skrivet) continue;
        ut.push({ namn: f.namn, value: skrivet, bekraftat: false });
      }
    }
    return ut;
  }

  readonly harAndringar = computed(() => {
    // Läser signalerna så att knappen räknas om när man skriver.
    this.utkast();
    this.receipt();
    return this.andringar().length > 0;
  });

  async spara(): Promise<void> {
    const rattelser = this.andringar();
    if (rattelser.length === 0) return;
    this.sparar.set(true);
    try {
      const svar = await fetch(`/api/receipts/${this.id()}/falt/flera`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rattelser }),
      });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (svar.status === 400) {
        const { message } = (await svar.json()) as { message?: string };
        this.error.set(message ?? 'Värdet gick inte att spara.');
        return;
      }
      if (!svar.ok) throw new Error(String(svar.status));
      this.receipt.set((await svar.json()) as Receipt);
      this.fyllUtkast();
      this.sparat.set(true);
      this.error.set(null);
    } catch {
      this.error.set('Rättelsen gick inte att spara.');
    } finally {
      this.sparar.set(false);
    }
  }

  /** Tolkar kvittot här och nu, i den här webbläsaren. */
  async tolkaNu(): Promise<void> {
    this.tolkar.set(true);
    try {
      await this.tolkning.koraEtt(this.id());
      await this.load();
    } catch {
      this.error.set('Tolkningen gick inte att köra.');
    } finally {
      this.tolkar.set(false);
    }
  }

  /** Kastar texten och läser om bilden direkt. Bilderna är kvar; rättelser också. */
  async lasOm(): Promise<void> {
    this.tolkar.set(true);
    try {
      const svar = await fetch(`/api/receipts/${this.id()}/lasom`, { method: 'POST' });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      await this.tolkning.koraEtt(this.id());
      await this.load();
    } catch {
      this.error.set('Kvittot gick inte att läsa om.');
    } finally {
      this.tolkar.set(false);
    }
  }

  readonly vissRadera = signal(false);

  /**
   * Två steg med flit. Bilderna finns ingen annanstans och papperet är slängt, så det
   * här är den enda handlingen i appen som inte går att ta tillbaka.
   */
  fragaRadera(): void {
    this.vissRadera.set(true);
  }

  avbrytRadera(): void {
    this.vissRadera.set(false);
  }

  async radera(): Promise<void> {
    this.sparar.set(true);
    try {
      const svar = await fetch(`/api/receipts/${this.id()}`, { method: 'DELETE' });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok && svar.status !== 404) throw new Error(String(svar.status));
      await this.router.navigateByUrl('/dator/kvitton');
    } catch {
      this.error.set('Kvittot gick inte att ta bort.');
      this.sparar.set(false);
    }
  }

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
      this.fyllUtkast();
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
