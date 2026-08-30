import { Injectable, signal } from '@angular/core';
import type { Niva, OcrSvar, Rotation, Tider } from './ocr.worker';
import type { Orientering } from './orientering';

export type Utfall = {
  text: string;
  rader: { text: string; confidence: number }[];
  ms: Tider;
  bild: { bredd: number; hojd: number };
  orientering: Orientering | null;
};

/**
 * Ägare av OCR-workern. En i hela appen, av två skäl: modellen är sex megabyte och
 * ska laddas en gång, och två workrar som tolkar samtidigt på en telefon konkurrerar
 * om samma kärnor utan att bli snabbare.
 *
 * Tjänsten vet ingenting om kön eller om vem som ska arbeta. Den kör en bild och
 * svarar. Vem som frågar, och när, avgörs på ytorna — telefonen av sig själv, datorn
 * bara när någon trycker.
 */
@Injectable({ providedIn: 'root' })
export class OcrService {
  private worker: Worker | null = null;
  private readonly vantande = new Map<string, (svar: OcrSvar) => void>();
  private n = 0;

  /** Hur lång uppvärmningen tog per nivå. Mest för mätsidan, men säger också om
   *  modellen alls gick att ladda. */
  readonly uppvarmning = signal<Record<string, number>>({});
  readonly isolerad = signal(crossOriginIsolated);

  private starta(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./ocr.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<OcrSvar>) => {
      if (data.typ === 'redo') {
        this.uppvarmning.update((u) => ({ ...u, [data.niva]: data.ms }));
        this.vantande.get(`varm:${data.niva}`)?.(data);
        return;
      }
      this.vantande.get(data.id)?.(data);
    };
    // En worker som dör tar med sig varje väntande löfte. Utan det här hänger
    // anroparen för alltid i stället för att få veta att det gick fel.
    const doden = (meddelande: string): void => {
      for (const [nyckel, svara] of [...this.vantande]) {
        this.vantande.delete(nyckel);
        svara({ typ: 'fel', id: nyckel, niva: 'tiny', meddelande });
      }
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker.onerror = (e) => doden(e.message || 'tolkningen kraschade');
    this.worker.onmessageerror = () => doden('ett svar från tolkningen gick inte att läsa');
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

  /** Laddar modellen i förväg. Utan den betalar första bilden hela uppstarten. */
  varm(niva: Niva): Promise<OcrSvar> {
    return this.fraga(`varm:${niva}`, { typ: 'varm', niva });
  }

  /**
   * Kör en bild. Bytesen överförs till workern och är oanvändbara efteråt — skicka in
   * en kopia om anroparen behöver dem kvar.
   */
  async tolka(bytes: ArrayBuffer, niva: Niva = 'tiny', rotation: Rotation = 'auto'): Promise<Utfall> {
    const id = `bild:${++this.n}`;
    const svar = await this.fraga(id, { id, niva, bytes, rotation }, [bytes]);
    if (svar.typ !== 'klar') {
      throw new Error(svar.typ === 'fel' ? svar.meddelande : 'oväntat svar från workern');
    }
    return { text: svar.text, rader: svar.rader, ms: svar.ms, bild: svar.bild, orientering: svar.orientering };
  }
}
