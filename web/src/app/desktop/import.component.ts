import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MenyComponent } from '../shared/meny.component';
import { ulid } from '../shared/ulid';

type Rad = {
  namn: string;
  status: 'väntar' | 'skickar' | 'klar' | 'fel';
  id?: string;
  fel?: string;
};

/**
 * Import från datorn: en hög bilder in i arkivet.
 *
 * Fångsten bor på telefonen, och det är rätt för ett kvitto man just fått i handen.
 * Men en hög som redan ligger i en mapp — inskannad, nedladdad, eller fotograferad
 * med något annat — har ingen väg in, och att fota om en skärm vore att kopiera bort
 * kvaliteten.
 *
 * **En bild är ett kvitto här.** Ett långt kvitto i flera bilder blir ett kvitto per
 * bild vid importen, och de slås ihop av matchningen om de visar samma köp; går det
 * inte finns *Lägg till bild* på kvittot. Att gissa vilka filer som hör ihop av
 * ordningen i en mapp vore just den sortens gissning som senare måste ångras.
 *
 * Filerna skickas en i taget. Servern kvitterar varje bild med sitt sha256 innan
 * nästa börjar, och en avbruten import lämnar det som hunnit fram i arkivet — inget
 * halvt kvitto, inga tappade bilder.
 */
@Component({
  selector: 'app-import',
  imports: [RouterLink, MenyComponent],
  templateUrl: './import.component.html',
})
export class ImportComponent {
  private readonly router = inject(Router);

  readonly rader = signal<Rad[]>([]);
  readonly kor = signal(false);

  readonly klara = computed(() => this.rader().filter((r) => r.status === 'klar').length);
  readonly fel = computed(() => this.rader().filter((r) => r.status === 'fel').length);
  readonly kvar = computed(() => this.rader().filter((r) => r.status === 'väntar' || r.status === 'skickar').length);

  private filer: File[] = [];

  valj(event: Event): void {
    const valda = [...((event.target as HTMLInputElement).files ?? [])];
    (event.target as HTMLInputElement).value = '';
    this.lagg(valda);
  }

  slapp(event: DragEvent): void {
    event.preventDefault();
    this.lagg([...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/')));
  }

  over(event: DragEvent): void {
    event.preventDefault();
  }

  /** Filnamnsordning, för en hög från en kamera ligger i tidsordning i mappen. */
  private lagg(valda: File[]): void {
    if (valda.length === 0) return;
    this.filer = [...this.filer, ...valda].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    this.rader.set(this.filer.map((f) => ({ namn: f.name, status: 'väntar' })));
  }

  rensa(): void {
    if (this.kor()) return;
    this.filer = [];
    this.rader.set([]);
  }

  /**
   * Skickar en fil i taget: skapa kvittot med klientens ULID, lägg bilden på det, och
   * säg att fångsten är hel. Samma tre steg som telefonen tar, och samma idempotens —
   * ett omtaget anrop träffar samma kvitto i stället för att skapa ett andra.
   */
  async importera(): Promise<void> {
    if (this.kor() || this.filer.length === 0) return;
    this.kor.set(true);
    try {
      for (const [i, fil] of this.filer.entries()) {
        if (this.rader()[i]?.status === 'klar') continue;
        this.satt(i, { status: 'skickar' });
        try {
          const id = ulid();
          await this.skicka('/api/receipts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, backlog: true }),
          });

          const kropp = new FormData();
          kropp.append('file', fil);
          await this.skicka(`/api/receipts/${id}/segments/1`, { method: 'POST', body: kropp });

          await this.skicka(`/api/receipts/${id}/complete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ segments: 1 }),
          });
          this.satt(i, { status: 'klar', id });
        } catch (orsak) {
          this.satt(i, { status: 'fel', fel: (orsak as Error).message });
        }
      }
    } finally {
      this.kor.set(false);
    }
  }

  private satt(index: number, delar: Partial<Rad>): void {
    this.rader.update((rader) => rader.map((rad, i) => (i === index ? { ...rad, ...delar } : rad)));
  }

  private async skicka(url: string, init: RequestInit): Promise<Response> {
    const svar = await fetch(url, init);
    if (svar.status === 401) {
      await this.router.navigateByUrl('/logga-in');
      throw new Error('Utloggad');
    }
    if (!svar.ok) throw new Error(`Servern svarade ${svar.status}`);
    return svar;
  }
}
