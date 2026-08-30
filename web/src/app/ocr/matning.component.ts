import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Niva, Rotation, Tider } from './ocr.worker';
import type { Orientering } from './orientering';
import { OcrService } from './ocr.service';

type Kalla = 'arkiv' | 'filer';

type Bild = { namn: string; bytes: ArrayBuffer };

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
  orientering: Orientering | null;
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
 * Bilderna hämtas ur arkivet. Det är hela poängen med att ha ett arkiv — att slippa
 * leta upp samma filer igen på varje maskin man vill mäta på.
 */
@Component({
  selector: 'app-matning',
  host: { 'data-density': 'comfortable' },
  imports: [],
  templateUrl: './matning.component.html',
  styleUrl: './matning.component.css',
})
export class MatningComponent {
  private readonly router = inject(Router);
  /** Samma worker som tolkningen använder: modellen ska laddas en gång, inte två. */
  private readonly ocr = inject(OcrService);

  readonly isolerad = this.ocr.isolerad;
  readonly uppvarmning = this.ocr.uppvarmning;
  readonly kalla = signal<Kalla>('arkiv');
  readonly nivaer = signal<Niva[]>(['tiny']);
  readonly rotation = signal<Rotation>('auto');
  readonly antal = signal(5);

  readonly arkivet = signal<{ id: string; capturedAt: string; segments: number }[] | null>(null);
  readonly korande = signal<string | null>(null);
  readonly rader = signal<Rad[]>([]);
  readonly fel = signal<string[]>([]);

  readonly rotationsval: Rotation[] = ['auto', 0, 90, 180, 270];

  readonly sammanfattning = computed(() => {
    const per = new Map<Niva, Rad[]>();
    for (const rad of this.rader()) per.set(rad.niva, [...(per.get(rad.niva) ?? []), rad]);
    return [...per.entries()].map(([niva, rader]) => ({
      niva,
      bilder: rader.length,
      tecken: Math.round(medel(rader.map((r) => r.tecken))),
      ms: Math.round(medel(rader.map((r) => r.ms.totalt))),
      rataMs: Math.round(medel(rader.map((r) => r.ms.rata))),
      tolkMs: Math.round(medel(rader.map((r) => r.ms.tolka))),
      median: rund(medel(rader.map((r) => r.median))),
      p10: rund(medel(rader.map((r) => r.p10))),
      teckenPerRad: rund(medel(rader.map((r) => r.teckenPerRad))),
      vridna: rader.filter((r) => (r.orientering?.rotation ?? 0) !== 0).length,
      osakra: rader.filter((r) => r.orientering?.osaker).length,
    }));
  });

  constructor() {
    void this.hamtaArkivet();
  }

  private async hamtaArkivet(): Promise<void> {
    try {
      const svar = await fetch('/api/receipts?limit=50');
      if (svar.status === 401) return void this.router.navigateByUrl('/logga-in');
      if (!svar.ok) throw new Error(String(svar.status));
      const body = (await svar.json()) as { receipts: { id: string; capturedAt: string; segments: number }[] };
      this.arkivet.set(body.receipts);
    } catch {
      this.arkivet.set([]);
      this.fel.update((f) => [...f, 'Kunde inte läsa arkivet.']);
    }
  }

  vaxla(niva: Niva): void {
    this.nivaer.update((n) => (n.includes(niva) ? n.filter((x) => x !== niva) : [...n, niva]));
  }

  valjRotation(r: Rotation): void {
    this.rotation.set(r);
  }

  valjKalla(k: Kalla): void {
    this.kalla.set(k);
  }

  onAntal(event: Event): void {
    this.antal.set(Number((event.target as HTMLInputElement).value));
  }

  rotationsetikett(r: Rotation): string {
    return r === 'auto' ? 'auto' : `${r}°`;
  }

  /** Hämtar originalbilderna ur arkivet — inte tumnaglarna, som är 480 px och härledda. */
  private async bilderUrArkivet(): Promise<Bild[]> {
    const valda = (this.arkivet() ?? []).slice(0, this.antal());
    const ut: Bild[] = [];
    for (const kvitto of valda) {
      const svar = await fetch(`/api/receipts/${kvitto.id}`);
      if (!svar.ok) {
        this.fel.update((f) => [...f, `${kvitto.id}: kunde inte läsa kvittot (${svar.status})`]);
        continue;
      }
      const detalj = (await svar.json()) as { segments: { file: string }[] };
      for (const segment of detalj.segments) {
        const bild = await fetch(`/api/receipts/${kvitto.id}/files/${segment.file}`);
        if (!bild.ok) {
          this.fel.update((f) => [...f, `${kvitto.id}/${segment.file}: ${bild.status}`]);
          continue;
        }
        ut.push({ namn: `${kvitto.id}/${segment.file}`, bytes: await bild.arrayBuffer() });
      }
    }
    return ut;
  }

  async koraArkiv(): Promise<void> {
    this.rader.set([]);
    this.fel.set([]);
    this.korande.set('Hämtar bilder ur arkivet …');
    const bilder = await this.bilderUrArkivet();
    if (bilder.length === 0) {
      this.korande.set(null);
      this.fel.update((f) => [...f, 'Inga bilder att mäta på.']);
      return;
    }
    await this.kor(bilder);
  }

  async onFiler(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const filer = [...(input.files ?? [])];
    input.value = '';
    if (filer.length === 0) return;
    this.rader.set([]);
    this.fel.set([]);
    const bilder: Bild[] = [];
    for (const fil of filer) bilder.push({ namn: fil.name, bytes: await fil.arrayBuffer() });
    await this.kor(bilder);
  }

  private async kor(bilder: Bild[]): Promise<void> {
    for (const niva of this.nivaer()) {
      this.korande.set(`Laddar modellen (${niva}) …`);
      await this.ocr.varm(niva);
    }

    let n = 0;
    for (const bild of bilder) {
      n++;
      for (const niva of this.nivaer()) {
        this.korande.set(`${niva} · bild ${n} av ${bilder.length} · ${bild.namn}`);
        // Bytesen överförs till workern, inte kopieras — därför en egen kopia per nivå.
        try {
          const utfall = await this.ocr.tolka(bild.bytes.slice(0), niva, this.rotation());
          const konf = utfall.rader.map((r) => r.confidence).sort((a, b) => a - b);
          const tecken = utfall.text.length;
          this.rader.update((r) => [
            ...r,
            {
              fil: bild.namn,
              niva,
              tecken,
              rader: utfall.rader.length,
              teckenPerRad: utfall.rader.length ? tecken / utfall.rader.length : 0,
              median: kvantil(konf, 0.5),
              p10: kvantil(konf, 0.1),
              ms: utfall.ms,
              bild: utfall.bild,
              orientering: utfall.orientering,
              text: utfall.text,
            },
          ]);
        } catch (fel) {
          this.fel.update((f) => [...f, `${bild.namn} (${niva}): ${(fel as Error).message}`]);
        }
      }
    }
    this.korande.set(null);
  }

  /** Textfilen är hela poängen: den ska gå att lägga bredvid out-gamla/ och jämföras. */
  laddaNer(): void {
    const rader = this.rader();
    const o = (x: Orientering | null): string =>
      !x
        ? 'rotation tvingad'
        : `rotation ${x.rotation}°  höga ${x.hogaAndel}  konfidens ${x.konfidens ?? '—'}  ` +
          `marginal ${x.marginal ?? '—'}  prov ${x.prov}${x.eskalerad ? ' (eskalerad)' : ''}` +
          `${x.osaker ? '  OSÄKER' : ''}  ${x.ms} ms`;

    const rapport = [
      `receipt-trackr M5a — mätning i webbläsare`,
      `tid            ${new Date().toISOString()}`,
      `useragent      ${navigator.userAgent}`,
      `kärnor         ${navigator.hardwareConcurrency ?? 'okänt'}`,
      `isolerad       ${crossOriginIsolated} (flertrådad WASM ${crossOriginIsolated ? 'på' : 'AV'})`,
      `källa          ${this.kalla() === 'arkiv' ? 'arkivet' : 'egna filer'}`,
      `rotation       ${this.rotationsetikett(this.rotation())}`,
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
          `(uppräting ${String(s.rataMs).padStart(5)} ms, tolkning ${String(s.tolkMs).padStart(6)} ms)  ` +
          `median ${s.median}  p10 ${s.p10}  tecken/rad ${s.teckenPerRad}  ` +
          `vridna ${s.vridna}/${s.bilder}  osäkra ${s.osakra}`,
      ),
      ``,
      `PER BILD`,
      ...rader.map(
        (r) =>
          `  ${r.fil}\n` +
          `    nivå ${r.niva}  ${r.bild.bredd}x${r.bild.hojd}  ${r.tecken} tecken  ${r.rader} rader  ` +
          `tecken/rad ${rund(r.teckenPerRad)}\n` +
          `    median ${r.median}  p10 ${r.p10}\n` +
          `    orientering: ${o(r.orientering)}\n` +
          `    ms: avkoda ${r.ms.avkoda}  förbehandla ${r.ms.forbehandla}  uppräting ${r.ms.rata}  ` +
          `tolka ${r.ms.tolka}  totalt ${r.ms.totalt}`,
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
