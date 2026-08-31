import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TolkningService } from '../ocr/tolkning.service';
import { MenyComponent } from '../shared/meny.component';
import { RaderaRutaComponent } from '../shared/radera-ruta.component';
import { tidpunkt } from '../shared/datum';

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
  imports: [RouterLink, MenyComponent, RaderaRutaComponent],
  templateUrl: './aktivitet.component.html',
})
export class AktivitetComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly avslut = inject(DestroyRef);
  readonly tolkning = inject(TolkningService);

  /** Samma skärm på båda ytorna; menyn och länkarna följer den man kom ifrån. */
  readonly yta = computed<'mobil' | 'dator'>(() =>
    this.route.snapshot.url.some((s) => s.path === 'telefon') ? 'mobil' : 'dator',
  );

  readonly data = signal<Aktivitet | null>(null);
  readonly error = signal<string | null>(null);

  readonly rader = computed(() => this.data()?.receipts ?? []);
  readonly vantar = computed(() => this.data()?.vantar ?? 0);
  readonly total = computed(() => this.data()?.total ?? 0);
  readonly fardiga = computed(() => Math.max(0, this.total() - this.rader().length));

  constructor() {
    void this.load();
    void this.tolkning.rakna();
    this.lyssnaPaFokus();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const svar = await fetch('/api/aktivitet');
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      this.data.set((await svar.json()) as Aktivitet);
    } catch {
      this.error.set('Aktiviteten gick inte att hämta. Försök igen.');
    }
  }

  async tolka(): Promise<void> {
    await this.tolkning.kor();
    await this.load();
  }

  readonly arbetar = signal(false);
  /** Vilket kvitto som just nu läses om här. Raden visar en snurra i stället för knappen. */
  readonly arbetarMed = signal<string | null>(null);

  /**
   * Listan hämtas om när fönstret får fokus. Knappen *Uppdatera* var ett handgrepp
   * för något appen kan göra själv — och en knapp till att välja mellan.
   *
   * Lyssnaren tas bort med komponenten. Ett `addEventListener` utan sitt
   * `removeEventListener` är samma fel som pulslyssnaren i tolkningstjänsten var:
   * skärmen är borta, men något den startade lever kvar och hämtar.
   */
  private lyssnaPaFokus(): void {
    const pa = (): void => void this.load();
    window.addEventListener('focus', pa);
    this.avslut.onDestroy(() => window.removeEventListener('focus', pa));
  }

  /**
   * Läser om bilden och tolkar den på fläcken, i den här webbläsaren.
   *
   * Det var tidigare två steg: kvittot lades tillbaka i kön och användaren fick trycka
   * *Tolka här*. Ett tryck är en handling — den som pekat på ett kvitto har redan sagt
   * vad hen vill, och att kön existerar är inte hens problem.
   */
  /**
   * Markerade kvitton. En omläsning i taget är rätt när man sett bilden och vet vad
   * som är fel med den; en hel hög är rätt när utvinningen blivit bättre. Det senare
   * är vad kryssrutorna finns till, och det är det enda stället i appen där en lista
   * betas av — den listan har han valt själv.
   */
  readonly valda = signal(new Set<string>());

  readonly allaValda = computed(() => this.rader().length > 0 && this.valda().size === this.rader().length);
  readonly nagraValda = computed(() => this.valda().size > 0 && !this.allaValda());

  vaxla(id: string): void {
    this.valda.update((valda) => {
      const ny = new Set(valda);
      if (!ny.delete(id)) ny.add(id);
      return ny;
    });
  }

  avmarkera(): void {
    this.valda.set(new Set());
  }

  /** Raderingen bor bakom samma grind som i arkivet, och samma ruta ritar den. */
  readonly fragar = signal(false);
  readonly raderar = signal(false);

  async radera(ordet: string): Promise<void> {
    this.raderar.set(true);
    try {
      const svar = await fetch('/api/receipts/radera', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [...this.valda()], bekraftelse: ordet }),
      });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      this.fragar.set(false);
      this.avmarkera();
      await this.load();
      await this.tolkning.rakna();
    } catch {
      this.error.set('Kvittona gick inte att ta bort.');
    } finally {
      this.raderar.set(false);
    }
  }

  valjAlla(event: Event): void {
    const pa = (event.target as HTMLInputElement).checked;
    this.valda.set(pa ? new Set(this.rader().map((r) => r.id)) : new Set());
  }

  /**
   * Läser om de markerade, ett i taget.
   *
   * Ett i taget och inte parallellt: tolkningen äter en kärna per bild, och den här
   * datorn ska gå att använda under tiden. Ordningen är listans, så den som tittar
   * ser kön krympa uppifrån.
   */
  async lasOmValda(): Promise<void> {
    const ids = this.rader()
      .map((r) => r.id)
      .filter((id) => this.valda().has(id));
    for (const id of ids) {
      await this.lasOm(id);
      this.valda.update((valda) => {
        const ny = new Set(valda);
        ny.delete(id);
        return ny;
      });
    }
  }

  async lasOm(id: string): Promise<void> {
    this.arbetar.set(true);
    this.arbetarMed.set(id);
    try {
      const svar = await fetch(`/api/receipts/${id}/lasom`, { method: 'POST' });
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      await this.tolkning.koraEtt(id);
      await this.tolkning.rakna();
      await this.load();
    } catch {
      this.error.set('Kvittot gick inte att tolka om.');
    } finally {
      this.arbetarMed.set(null);
      this.arbetar.set(false);
    }
  }

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

  /**
   * Färgen på statusmärket. Alltid tillsammans med ordet, aldrig i stället för det:
   * tas färgen bort står det fortfarande vad som saknas.
   */
  badge(rad: Rad): string {
    if (rad.lage === 'bilder' || rad.lage === 'svag_text') return 'badge-soft badge-error';
    if (rad.lage === 'vantar') return 'badge-ghost';
    return 'badge-soft badge-warning';
  }

  butik(rad: Rad): string {
    return rad.store ?? '—';
  }

  belopp(rad: Rad): string {
    return rad.total === null ? '—' : `${rad.total.toFixed(2).replace('.', ',')} kr`;
  }

  readonly fangat = tidpunkt;
}

const lista = (ord: string[]): string =>
  ord.length <= 1 ? (ord[0] ?? 'fält') : `${ord.slice(0, -1).join(', ')} och ${ord.at(-1)}`;
