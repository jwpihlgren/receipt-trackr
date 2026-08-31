import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { MenyComponent } from '../shared/meny.component';

/** Svaret från `/api/health` — samma form som servern lovar i http/health.ts. */
export type Health = {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  data: {
    path: string;
    mount: string | null;
    filesystem: string | null;
    free: string;
    total: string;
    minFree: string;
    belowFloor: boolean;
  };
  backupDir: string | null;
};

/**
 * M1 har ingen egen funktion att visa upp. Vyn finns för att bevisa att kedjan
 * hänger ihop — webbygget serveras av samma process som API:t — och för att svara
 * på den enda fråga driften har innan det finns kvitton: ligger arkivet rätt, och
 * hur mycket är kvar?
 */
@Component({
  selector: 'app-drift',
  imports: [MenyComponent],
  templateUrl: './drift.component.html',
})
export class DriftComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly health = signal<Health | null>(null);
  readonly error = signal<string | null>(null);
  readonly raknarOm = signal(false);
  readonly omrakning = signal<string | null>(null);

  constructor() {
    this.refresh();
  }

  /**
   * Räknar om fälten ur den text som redan lästs, för hela arkivet.
   *
   * Ingen bild läses om: det här är utvinningens regler körda en gång till, vilket är
   * vad man vill när reglerna blivit bättre. Rättelser står kvar — de skrivs aldrig
   * över av maskinen.
   */
  async raknaOmFalt(): Promise<void> {
    this.raknarOm.set(true);
    this.omrakning.set(null);
    this.error.set(null);
    try {
      const svar = await fetch('/api/falt/omtolka', { method: 'POST' });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      const { omtolkade, utanText } = (await svar.json()) as { omtolkade: number; utanText: number };
      // Kvitton utan text hoppas över, och det ska sägas: annars ser summan för låg ut
      // och det går inte att veta om något gick fel eller om bilderna inte lästs än.
      this.omrakning.set(
        utanText > 0
          ? `${omtolkade} kvitton räknades om. ${utanText} har ingen läst text ännu.`
          : `${omtolkade} kvitton räknades om.`,
      );
    } catch {
      this.error.set('Fälten gick inte att räkna om.');
    } finally {
      this.raknarOm.set(false);
    }
  }

  refresh(): void {
    this.error.set(null);
    // 503 vid lågt utrymme är ett giltigt svar med kropp, inte ett fel att svälja:
    // det är exakt det läget vyn finns för att visa.
    this.http.get<Health>('/api/health', { observe: 'response' }).subscribe({
      next: (response) => this.health.set(response.body),
      error: (err: { status?: number; error?: Health; message?: string }) => {
        // En utgången session är inte ett driftfel. Vyn skrev ut HttpClients egen
        // rad — "Http failure response for /api/health: 401" — som om servern varit
        // sjuk, i stället för att göra det varje annan vy här gör: skicka till
        // inloggningen. Den som läser den raden får veta att något gått fel med
        // arkivet, vilket är osant och dessutom skrämmande på just den här sidan.
        if (err.status === 401 || err.status === 403) {
          void this.router.navigateByUrl('/logga-in');
          return;
        }
        if (err.error?.status) this.health.set(err.error);
        else this.error.set(err.message ?? 'Servern svarar inte.');
      },
    });
  }
}
