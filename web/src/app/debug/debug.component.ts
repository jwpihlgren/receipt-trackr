/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TILLFÄLLIG MÄTSIDA — SKA TAS BORT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Byggd 2026-08-30 på beställarens uttryckliga tillåtelse, för att han ska kunna
 * köra sina egna kvitton genom kedjan och få siffror ur den. Den är **inte** en del
 * av appen: den står inte i menyn, den ligger utanför `/telefon` och `/dator`, och
 * ingen annan fil i projektet importerar något härifrån.
 *
 * **Så tas den bort, helt:**
 *   1. radera katalogen `web/src/app/debug/`
 *   2. radera rutt-blocket märkt "TILLFÄLLIG MÄTSIDA" i `web/src/app/app.routes.ts`
 * Det är allt. Servern är orörd — sidan använder bara rutter som appen redan har.
 *
 * Varför den finns: kalibreringsurvalet har inga siffror, gränsen 7 för svagt läst
 * text är oprövad mot en riktig hög, och ingenting är kört mot beställarens egna
 * kvitton. Ett mätuttag är inte en uppgift i appen — ingen skärm får presentera en
 * lista att beta av — så mätningen bor här, i något som slängs.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { OcrService } from '../ocr/ocr.service';
import type { Niva, Rotation } from '../ocr/ocr.worker';
import { ulid } from '../shared/ulid';
import { sha256 } from '../shared/sha256';

type Falt = { value: string | number; confidence: number; source: string } | undefined;

type Rad = {
  fil: string;
  bytes: number;
  px: string;
  /** Vad uppräteningen valde, och hur säkert. */
  rotation: number | null;
  rotationMarginal: number | null;
  ms: { avkoda: number; forbehandla: number; rata: number; tolka: number; totalt: number };
  tecken: number;
  rader: number;
  teckenPerRad: number;
  median: number;
  p10: number;
  /** Vad servern utvann ur texten, när kvittot sparades. */
  butik: string | null;
  datum: string | null;
  belopp: number | null;
  lage: string | null;
  id: string | null;
  fel: string | null;
  /** Råtexten. Det är den man vill se när en siffra ser fel ut. */
  text: string;
};

@Component({
  selector: 'app-debug',
  imports: [],
  templateUrl: './debug.component.html',
  styleUrl: './debug.component.css',
})
export class DebugComponent {
  private readonly ocr = inject(OcrService);

  readonly niva = signal<Niva>('tiny');
  readonly rotation = signal<Rotation>('auto');
  /** Sparar körningen i arkivet, eller mäter bara. Av som standard: mätning ska inte
   *  fylla arkivet med provbilder om man inte bett om det. */
  readonly spara = signal(false);

  readonly rader = signal<Rad[]>([]);
  readonly kor = signal(false);
  readonly steg = signal<string | null>(null);
  readonly fel = signal<string | null>(null);
  readonly kopierat = signal(false);
  readonly isolerad = this.ocr.isolerad;
  readonly uppvarmning = this.ocr.uppvarmning;

  readonly klara = computed(() => this.rader().filter((r) => !r.fel));
  /** Vilken rads råtext som är utfälld. En i taget räcker. */
  readonly oppen = signal<number | null>(null);

  visa(i: number): void {
    this.oppen.update((n) => (n === i ? null : i));
  }

  /** Sammandraget. Median och inte medel: en enda katastrofbild ska inte flytta talet. */
  readonly summa = computed(() => {
    const r = this.klara();
    if (r.length === 0) return null;
    return {
      antal: r.length,
      msMedian: median(r.map((x) => x.ms.totalt)),
      teckenMedian: median(r.map((x) => x.tecken)),
      teckenPerRadMedian: median(r.map((x) => x.teckenPerRad)),
      konfidensMedian: median(r.map((x) => x.median)),
      /** Hur många som skulle flaggas som svagt lästa av gränsen i `index-db.ts`. */
      underGransen: r.filter((x) => x.teckenPerRad > 0 && x.teckenPerRad < 7).length,
      medButik: r.filter((x) => x.butik).length,
      medDatum: r.filter((x) => x.datum).length,
      medBelopp: r.filter((x) => x.belopp !== null).length,
      vandaBilder: r.filter((x) => x.rotation !== null && x.rotation !== 0).length,
    };
  });

  valjNiva(e: Event): void {
    this.niva.set((e.target as HTMLSelectElement).value as Niva);
  }

  valjRotation(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.rotation.set(v === 'auto' ? 'auto' : (Number(v) as Rotation));
  }

  valjSpara(e: Event): void {
    this.spara.set((e.target as HTMLInputElement).checked);
  }

  rensa(): void {
    this.rader.set([]);
    this.fel.set(null);
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const filer = [...(input.files ?? [])];
    input.value = '';
    if (filer.length === 0) return;

    this.kor.set(true);
    this.fel.set(null);
    try {
      this.steg.set('Laddar modellen …');
      await this.ocr.varm(this.niva());
      for (const [i, fil] of filer.entries()) {
        this.steg.set(`${i + 1} av ${filer.length}: ${fil.name}`);
        // Raden räknas ut först och läggs till sedan: `update()` tar en ren funktion,
        // och en `await` inuti den hade kört utanför signalens skrivning.
        const rad = await this.enBild(fil);
        this.rader.update((r) => [...r, rad]);
      }
    } catch (e) {
      this.fel.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.kor.set(false);
      this.steg.set(null);
    }
  }

  private async enBild(fil: File): Promise<Rad> {
    const bytes = await fil.arrayBuffer();
    const bas: Rad = {
      fil: fil.name,
      bytes: fil.size,
      px: '',
      rotation: null,
      rotationMarginal: null,
      ms: { avkoda: 0, forbehandla: 0, rata: 0, tolka: 0, totalt: 0 },
      tecken: 0,
      rader: 0,
      teckenPerRad: 0,
      median: 0,
      p10: 0,
      butik: null,
      datum: null,
      belopp: null,
      lage: null,
      id: null,
      fel: null,
      text: '',
    };

    try {
      // Kopian görs innan tolkningen: `tolka()` överför bytesen till workern, och
      // uppladdningen efteråt behöver dem kvar.
      const kopia = bytes.slice(0);
      const utfall = await this.ocr.tolka(bytes, this.niva(), this.rotation());
      const konfidenser = utfall.rader.map((r) => r.confidence).sort((a, b) => a - b);
      const tecken = utfall.text.length;

      const rad: Rad = {
        ...bas,
        px: `${utfall.bild.bredd}×${utfall.bild.hojd}`,
        rotation: utfall.orientering?.rotation ?? 0,
        rotationMarginal: utfall.orientering?.marginal ?? null,
        ms: utfall.ms,
        tecken,
        rader: utfall.rader.length,
        teckenPerRad: utfall.rader.length ? Math.round((tecken / utfall.rader.length) * 100) / 100 : 0,
        median: kvantil(konfidenser, 0.5),
        p10: kvantil(konfidenser, 0.1),
        text: utfall.text,
      };

      if (!this.spara()) return rad;
      return { ...rad, ...(await this.arkivera(fil, kopia, utfall.text, utfall.rader, rad)) };
    } catch (e) {
      return { ...bas, fel: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Lägger bilden i arkivet och lämnar in tolkningen, exakt som en riktig klient gör:
   * samma rutter, samma ordning, samma kropp. Poängen är att mätningen ska gå genom
   * kedjan som ska mätas — inte förbi den.
   */
  private async arkivera(
    fil: File,
    bytes: ArrayBuffer,
    text: string,
    rader: { text: string; confidence: number }[],
    rad: Rad,
  ): Promise<Partial<Rad>> {
    const id = ulid();
    const sha = await sha256(bytes);

    const skapad = await fetch('/api/receipts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, backlog: true }),
    });
    if (!skapad.ok) return { id, fel: `POST /api/receipts: ${skapad.status}` };

    const form = new FormData();
    form.append('capture', JSON.stringify({ source: 'matsidan', filnamn: fil.name }));
    form.append('file', new Blob([bytes], { type: fil.type || 'image/jpeg' }), fil.name);
    const lagd = await fetch(`/api/receipts/${id}/segments/1`, { method: 'POST', body: form });
    if (!lagd.ok) return { id, fel: `segment: ${lagd.status}` };
    const kvittens = (await lagd.json().catch(() => ({}))) as { sha256?: string };
    if (kvittens.sha256 !== sha) return { id, fel: 'servern kvitterade en annan sha256' };

    const klar = await fetch(`/api/receipts/${id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segments: 1 }),
    });
    if (!klar.ok) return { id, fel: `complete: ${klar.status}` };

    // Reservera jobbet och lämna in texten — annars vore kvittot otolkat i arkivet
    // trots att den här sidan just läst det.
    await fetch('/api/jobb/hamta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arbetare: 'matsidan', antal: 1, id }),
    });
    const inlamnat = await fetch(`/api/jobb/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        ocr: {
          motor: 'ppu-paddle-ocr/web',
          niva: this.niva(),
          arbetare: 'matsidan',
          vid: new Date().toISOString(),
          ms: rad.ms.totalt,
          rader,
          teckenPerRad: rad.teckenPerRad,
          median: rad.median,
          p10: rad.p10,
        },
      }),
    });
    if (!inlamnat.ok) return { id, fel: `jobb: ${inlamnat.status}` };

    const hamtat = await fetch(`/api/receipts/${id}`);
    if (!hamtat.ok) return { id, fel: `GET kvitto: ${hamtat.status}` };
    const kvitto = (await hamtat.json()) as {
      fields?: Record<string, Falt>;
      lage: string | null;
    };
    return {
      id,
      butik: (kvitto.fields?.['store']?.value as string) ?? null,
      datum: (kvitto.fields?.['date']?.value as string) ?? null,
      belopp: (kvitto.fields?.['total']?.value as number) ?? null,
      lage: kvitto.lage,
    };
  }

  /** Hela mätningen som JSON, att klistra in i samtalet. Det är sidans egentliga utdata. */
  async kopiera(): Promise<void> {
    const paket = {
      vid: new Date().toISOString(),
      niva: this.niva(),
      rotation: this.rotation(),
      sparat: this.spara(),
      crossOriginIsolated: this.isolerad(),
      uppvarmningMs: this.uppvarmning(),
      enhet: navigator.userAgent,
      kartor: navigator.hardwareConcurrency,
      summa: this.summa(),
      rader: this.rader(),
    };
    const text = JSON.stringify(paket, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.kopierat.set(true);
      setTimeout(() => this.kopierat.set(false), 3000);
    } catch {
      // Utan urklippsrättighet: lägg det i en ruta att markera för hand.
      this.fel.set(text);
    }
  }

  tal(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  }
}

function median(v: number[]): number {
  return kvantil([...v].sort((a, b) => a - b), 0.5);
}

function kvantil(sorterad: number[], p: number): number {
  if (sorterad.length === 0) return 0;
  const i = (sorterad.length - 1) * p;
  const lag = Math.floor(i);
  const hog = Math.ceil(i);
  const v = lag === hog ? sorterad[lag]! : sorterad[lag]! + (i - lag) * (sorterad[hog]! - sorterad[lag]!);
  return Math.round(v * 1000) / 1000;
}
