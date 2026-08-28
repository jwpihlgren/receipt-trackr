import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';

export type ReceiptRow = {
  id: string;
  capturedAt: string;
  segments: number;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
};

/**
 * Kvittolistan på mobilen. Medvetet mager: telefonen är till för att fånga, och det
 * enda man rimligen vill göra där utöver det är att kontrollera att kvittot faktiskt
 * kom fram och att titta på bilden. Fälten står tomma tills textutläsningen finns —
 * och en tom kolumn är ärligare än en påhittad.
 */
@Component({
  selector: 'app-receipts',
  host: { 'data-density': 'comfortable' },
  imports: [RouterLink],
  templateUrl: './receipts.component.html',
  styleUrl: './receipts.component.css',
})
export class ReceiptsComponent {
  private readonly http = inject(HttpClient);

  readonly receipts = signal<ReceiptRow[] | null>(null);
  readonly total = signal(0);
  readonly error = signal<string | null>(null);
  readonly open = signal<string | null>(null);

  constructor() {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.http.get<{ total: number; receipts: ReceiptRow[] }>('/api/receipts?limit=50').subscribe({
      next: (response) => {
        this.receipts.set(response.receipts);
        this.total.set(response.total);
      },
      error: () => this.error.set('Kunde inte hämta kvittona. Är du ansluten till tailnetet?'),
    });
  }

  toggle(id: string): void {
    this.open.update((current) => (current === id ? null : id));
  }

  /** Segmentens nummer är 1..n — bilderna hämtas på nummer, inte på filnamn. */
  indices(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  when(iso: string): string {
    return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
  }
}
