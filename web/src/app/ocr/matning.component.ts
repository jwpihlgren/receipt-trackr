import { Component, computed, signal } from '@angular/core';
import type { Niva, OcrSvar, Tider } from './ocr.worker';

type Rad = {
  fil: string;
  niva: Niva;
  tecken: number;
  rader: number;
  teckenPerRad: number;
  median: number;
  p10: number;
  ms: Tider;
  bild: { bredd: number; hojd: number };
  text: string;
};

/**
 * M5a: mätningen som avgör var textutläsningen får bo.
 *
 * M0 mätte i Node på en x86-burk och landade i tiny / raw / 1600 — 834 tecken per bild
 * på 1297 ms. De siffrorna säger ingenting om WebAssembly i en telefonwebbläsare, och
 * det är den frågan som avgör hela M5: orkar telefonen tolka sina egna kvitton, eller
 * är det datorn som får göra jobbet?
 *
 * Sidan är därför ingen funktion utan ett instrument. Den kör samma bilder genom samma
 * pipeline och lämnar en textfil som går att lägga bredvid `out-gamla/` och jämföra
 * rad för rad.
 */
@Component({
  selector: 'app-matning',
  host: { 'data-density': 'comfortable' },
  imports: [],
  templateUrl: './matning.component.html',
  styleUrl: './matning.component.css',
})
export class MatningComponent {
  private worker: Worker | null = null;
  private vantande = new Map<string, (svar: OcrSvar) => void>();

  readonly isolerad = signal(crossOriginIsolated);
  readonly nivaer = signal<Niva[]>(['tiny']);
  readonly korande = signal<string | null>(null);
  readonly uppvarmning = signal<Record<string, number>>({});
  readonly rader = signal<Rad[]>([]);
  readonly fel = signal<string[]>([]);

  readonly sammanfattning = computed(() => {
    const per = new Map<Niva, Rad[]>();
    for (const rad of this.rader()) per.set(rad.niva, [...(per.get(rad.niva) ?? []), rad]);
    return [...per.entries()].map(([niva, rader]) => ({
      niva,
      bilder: rader.length,
      tecken: Math.round(medel(rader.map((r) => r.tecken))),
      ms: Math.round(medel(rader.map((r) => r.ms.totalt))),
      tolkMs: Math.round(medel(rader.map((r) => r.ms.tolka))),
      median: rund(medel(rader.map((r) => r.median))),
      p10: rund(medel(rader.map((r) => r.p10))),
      teckenPerRad: rund(medel(rader.map((r) => r.teckenPerRad))),
    }));
  });

  private starta(): Worker {
    this.worker ??= new Worker(new URL('./ocr.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<OcrSvar>) => {
      if (data.typ === 'redo') {
        this.uppvarmning.update((u) => ({ ...u, [data.niva]: data.ms }));
        this.vantande.get(`varm:${data.niva}`)?.(data);
        return;
      }
      const nyckel = data.typ === 'fel' ? data.id : data.id;
      this.vantande.get(nyckel)?.(data);
    };
    return this.worker;
  }

  private fraga(nyckel: string, meddelande: unknown, overfor?: Transferable[]): Promise<OcrSvar> {
    const worker = this.starta();
    return new Promise((resolve) => {
      this.vantande.set(nyckel, (svar) => {
        this.vantande.delete(nyckel);
        resolve(svar);
      });
      worker.postMessage(meddelande, overfor ?? []);
    });
  }

  vaxla(niva: Niva): void {
    this.nivaer.update((n) => (n.includes(niva) ? n.filter((x) => x !== niva) : [...n, niva]));
  }

  async onFiler(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const filer = [...(input.files ?? [])];
    input.value = '';
    if (filer.length === 0) return;

    this.rader.set([]);
    this.fel.set([]);

    for (const niva of this.nivaer()) {
      this.korande.set(`Laddar modellen (${niva}) …`);
      await this.fraga(`varm:${niva}`, { typ: 'varm', niva });
    }

    let n = 0;
    for (const fil of filer) {
      n++;
      for (const niva of this.nivaer()) {
        this.korande.set(`${niva} · bild ${n} av ${filer.length} · ${fil.name}`);
        const bytes = await fil.arrayBuffer();
        const id = `${fil.name}:${niva}:${n}`;
        const svar = await this.fraga(id, { id, niva, bytes }, [bytes]);

        if (svar.typ !== 'klar') {
          const skäl = svar.typ === 'fel' ? svar.meddelande : 'oväntat svar från workern';
          this.fel.update((f) => [...f, `${fil.name} (${niva}): ${skäl}`]);
          continue;
        }

        const konf = svar.rader.map((r) => r.confidence).sort((a, b) => a - b);
        const tecken = svar.text.length;
        this.rader.update((r) => [
          ...r,
          {
            fil: fil.name,
            niva,
            tecken,
            rader: svar.rader.length,
            teckenPerRad: svar.rader.length ? tecken / svar.rader.length : 0,
            median: kvantil(konf, 0.5),
            p10: kvantil(konf, 0.1),
            ms: svar.ms,
            bild: svar.bild,
            text: svar.text,
          },
        ]);
      }
    }
    this.korande.set(null);
  }

  /** Textfilen är hela poängen: den ska gå att lägga bredvid out-gamla/ och jämföras. */
  laddaNer(): void {
    const rader = this.rader();
    const rapport = [
      `receipt-trackr M5a — mätning i webbläsare`,
      `tid            ${new Date().toISOString()}`,
      `useragent      ${navigator.userAgent}`,
      `kärnor         ${navigator.hardwareConcurrency ?? 'okänt'}`,
      `isolerad       ${crossOriginIsolated} (flertrådad WASM ${crossOriginIsolated ? 'på' : 'AV'})`,
      `uppvärmning    ${JSON.stringify(this.uppvarmning())} ms`,
      ``,
      `Jämförelsetal ur M0 (Node, x86, samma bilder):`,
      `  tiny / raw / 1600   834 tecken/bild   1297 ms/bild   median 0,952   p10 0,747`,
      `  small / raw / 1600  707 tecken/bild   3590 ms/bild   median 0,944   p10 0,475`,
      ``,
      `SAMMANFATTNING`,
      ...this.sammanfattning().map(
        (s) =>
          `  ${s.niva.padEnd(6)} ${String(s.bilder).padStart(3)} bilder  ` +
          `${String(s.tecken).padStart(5)} tecken/bild  ${String(s.ms).padStart(6)} ms/bild  ` +
          `(varav tolkning ${String(s.tolkMs).padStart(6)} ms)  median ${s.median}  p10 ${s.p10}  ` +
          `tecken/rad ${s.teckenPerRad}`,
      ),
      ``,
      `PER BILD`,
      ...rader.map(
        (r) =>
          `  ${r.fil}\n` +
          `    nivå ${r.niva}  ${r.bild.bredd}x${r.bild.hojd}  ${r.tecken} tecken  ${r.rader} rader  ` +
          `tecken/rad ${rund(r.teckenPerRad)}\n` +
          `    median ${r.median}  p10 ${r.p10}\n` +
          `    ms: avkoda ${r.ms.avkoda}  förbehandla ${r.ms.forbehandla}  tolka ${r.ms.tolka}  totalt ${r.ms.totalt}`,
      ),
      ``,
      `FEL`,
      ...(this.fel().length ? this.fel().map((f) => `  ${f}`) : ['  inga']),
      ``,
      `RÅTEXT PER BILD`,
      ...rader.map((r) => `\n--- ${r.fil} (${r.niva}) ---\n${r.text}`),
    ].join('\n');

    const url = URL.createObjectURL(new Blob([rapport], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `m5a-matning-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

const medel = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rund = (x: number): number => Math.round(x * 1000) / 1000;

/** Sorterad indata. p10 är det tal M0 använde för att se botten, inte snittet. */
function kvantil(sorterad: number[], p: number): number {
  if (sorterad.length === 0) return 0;
  const i = (sorterad.length - 1) * p;
  const lag = Math.floor(i);
  const hog = Math.ceil(i);
  return rund(lag === hog ? sorterad[lag]! : sorterad[lag]! + (i - lag) * (sorterad[hog]! - sorterad[lag]!));
}
