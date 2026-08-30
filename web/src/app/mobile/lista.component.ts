import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { QueueService } from './queue.service';
import { CaptureFlowService } from './capture-flow.service';
import { MenyComponent } from '../shared/meny.component';
import { TolkningService } from '../ocr/tolkning.service';

export type ReceiptRow = {
  id: string;
  capturedAt: string;
  segments: number;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  /** Noll = ingen text utläst än. Det är listans enda ärliga tolkningsmått före M6. */
  tecken: number;
};

type Grupp = { rubrik: string; rader: ReceiptRow[] };

/**
 * Mobilens hemskärm: arkivet, inte kameran.
 *
 * Det är en omvändning mot hur appen började. Skälet är att fångsten är en handling
 * som tar tio sekunder några gånger i veckan, medan "kom kvittot fram?" och "vad
 * handlade jag för?" är frågor man ställer när som helst. Kameran är därför en knapp
 * på arkivet, inte tvärtom.
 *
 * Knappen är en `<label>` runt ett filinput. Ett tryck öppnar telefonens egen
 * kameraapp — appen har ingen egen sökare, och ska inte låtsas ha en.
 */
@Component({
  selector: 'app-lista',
  host: { 'data-density': 'comfortable' },
  imports: [RouterLink, MenyComponent],
  templateUrl: './lista.component.html',
  styleUrl: './lista.component.css',
})
export class ListaComponent {
  private readonly router = inject(Router);
  private readonly queue = inject(QueueService);
  readonly flow = inject(CaptureFlowService);
  /**
   * Telefonen tolkar av sig själv så länge appen är öppen. Det var hela poängen med
   * att fånga och tolka på samma enhet — och M5a visade att den orkar: två sekunder
   * per bild, snabbare än datorn, eftersom den når appen över https och därmed får
   * flertrådad WASM.
   */
  readonly tolkning = inject(TolkningService);

  readonly receipts = signal<ReceiptRow[] | null>(null);
  readonly total = signal(0);
  readonly error = signal<string | null>(null);
  readonly queueState = this.queue.snapshot;

  /** Kvitton som ännu ligger kvar i telefonen. Allt annat i listan är i arkivet. */
  private readonly local = computed(() => new Set(this.queueState().receipts));

  readonly kvarText = computed(() => {
    const s = this.queueState();
    if (s.stuck.length) return `${s.stuck.length} kom inte fram`;
    if (!s.waiting) return null;
    if (s.offline) return `${s.waiting} ${s.waiting === 1 ? 'kvitto väntar' : 'kvitton väntar'} på nät`;
    return `${s.waiting} ${s.waiting === 1 ? 'kvitto' : 'kvitton'} på väg till arkivet`;
  });

  readonly kvarIlla = computed(() => this.queueState().stuck.length > 0);

  /** En påbörjad fångst som överlevt att fliken lades i minnet, eller vräktes. */
  readonly paborjat = computed(() => this.flow.shots().length);

  readonly grupper = computed<Grupp[]>(() => {
    const list = this.receipts();
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

  constructor() {
    this.queue.start();
    void this.load();
    this.tolkning.startaLopande();

    // Hämtar om listan varje gång ett kvitto blivit tolkat. Utan det arbetar
    // tolkningen vidare medan raderna står kvar och säger "inte tolkat än".
    effect(() => {
      this.tolkning.klaraTotalt();
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const response = await fetch('/api/receipts?limit=50');
      if (response.status === 401) {
        await this.router.navigateByUrl('/logga-in');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { total: number; receipts: ReceiptRow[] };
      this.receipts.set(body.receipts);
      this.total.set(body.total);
    } catch {
      this.error.set('Kunde inte hämta kvittona. Är burken igång?');
    }
  }

  klocka(iso: string): string {
    return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  status(rad: ReceiptRow): 'skickas' | 'arkiv' {
    return this.local().has(rad.id) ? 'skickas' : 'arkiv';
  }

  /** Trycket på knappen. Skärmen byter till väntläget medan kameraappen ligger över. */
  openCamera(): void {
    this.flow.markAwaiting();
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])].sort((a, b) => a.lastModified - b.lastModified);
    // Nollställs direkt: annars ger samma fil vald två gånger i rad ingen händelse.
    input.value = '';
    if (files.length === 0) {
      this.flow.cancelAwaiting();
      return;
    }
    for (const file of files) await this.flow.accept(file);
    if (this.flow.shots().length) await this.router.navigateByUrl('/telefon/fanga');
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
