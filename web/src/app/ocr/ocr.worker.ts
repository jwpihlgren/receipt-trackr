/// <reference lib="webworker" />

/**
 * Tolkningen, i en egen tråd.
 *
 * Workern är inte en optimering utan förutsättningen: WASM-inferens blockerar tråden
 * den kör på, och på huvudtråden fryser sidan tills hela bilden är läst. Här kan
 * användaren fortsätta fotografera medan förra kvittot tolkas — vilket är precis den
 * asynkrona bakgrundstolkning hela M5 bygger på.
 *
 * Modellerna hämtas från vår egen server, aldrig från Hugging Face. Se
 * scripts/hamta-modeller.mjs för varför.
 */
import { PaddleOcrService } from 'ppu-paddle-ocr/web';
import * as ort from 'onnxruntime-web';

/** M0 mätte fram tiny som vinnare. `small` finns med för att M5a ska kunna mäta om det. */
export type Niva = 'tiny' | 'small';

const MODELLER: Record<Niva, { detection: string; recognition: string; charactersDictionary: string }> = {
  tiny: {
    detection: '/modeller/detection/ort/PP-OCRv6_tiny_det.ort',
    recognition: '/modeller/recognition/ort/PP-OCRv6_tiny_rec.ort',
    charactersDictionary: '/modeller/recognition/ppocrv6_tiny_dict.txt',
  },
  small: {
    detection: '/modeller/detection/ort/PP-OCRv6_small_det.ort',
    recognition: '/modeller/recognition/ort/PP-OCRv6_small_rec.ort',
    charactersDictionary: '/modeller/recognition/ppocrv6_dict.txt',
  },
};

/**
 * Den mätta regeln ur M0: ingen kontrastbehandling, skalning till 1600 px bredd.
 * `clahe` föll bort i mätningen — den läste färre tecken och kostade tid.
 */
const BREDD = 1600;

export type OcrBegaran = { id: string; niva: Niva; bytes: ArrayBuffer };

export type OcrRad = { text: string; confidence: number };

export type OcrSvar =
  | { typ: 'klar'; id: string; niva: Niva; text: string; rader: OcrRad[]; ms: Tider; bild: { bredd: number; hojd: number } }
  | { typ: 'fel'; id: string; niva: Niva; meddelande: string }
  | { typ: 'redo'; niva: Niva; ms: number; leverantorer: string[] };

export type Tider = { avkoda: number; forbehandla: number; tolka: number; totalt: number };

// Runtimen ligger i imagen, inte på ett CDN — samma skäl som modellerna.
ort.env.wasm.wasmPaths = '/ort/';

const tjanster = new Map<Niva, Promise<PaddleOcrService>>();

function service(niva: Niva): Promise<PaddleOcrService> {
  let redan = tjanster.get(niva);
  if (redan) return redan;
  redan = (async () => {
    const s = new PaddleOcrService({ model: MODELLER[niva] });
    await s.initialize();
    return s;
  })();
  tjanster.set(niva, redan);
  return redan;
}

/** Avkodar och skalar. Bilden är redan upprätt: orienteringen bakas in vid fångst. */
async function forbered(bytes: ArrayBuffer): Promise<{ duk: OffscreenCanvas; bredd: number; hojd: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
  const skala = bitmap.width > BREDD ? BREDD / bitmap.width : 1;
  const bredd = Math.round(bitmap.width * skala);
  const hojd = Math.round(bitmap.height * skala);
  const duk = new OffscreenCanvas(bredd, hojd);
  duk.getContext('2d')!.drawImage(bitmap, 0, 0, bredd, hojd);
  bitmap.close();
  return { duk, bredd, hojd };
}

addEventListener('message', async (event: MessageEvent<OcrBegaran | { typ: 'varm'; niva: Niva }>) => {
  const data = event.data;

  if ('typ' in data && data.typ === 'varm') {
    const start = performance.now();
    try {
      await service(data.niva);
      const svar: OcrSvar = {
        typ: 'redo',
        niva: data.niva,
        ms: Math.round(performance.now() - start),
        leverantorer: [ort.env.webgpu?.adapter ? 'webgpu' : 'wasm'],
      };
      postMessage(svar);
    } catch (fel) {
      postMessage({ typ: 'fel', id: 'init', niva: data.niva, meddelande: (fel as Error).message } satisfies OcrSvar);
    }
    return;
  }

  const { id, niva, bytes } = data as OcrBegaran;
  const t0 = performance.now();
  try {
    const s = await service(niva);
    const t1 = performance.now();
    const { duk, bredd, hojd } = await forbered(bytes);
    const t2 = performance.now();
    const resultat = (await s.recognize(duk, { flatten: true })) as {
      text: string;
      results: { text: string; confidence: number }[];
      confidence: number;
    };
    const t3 = performance.now();

    // Rad för rad, inte bara den hopslagna texten: konfidensen per rad är måttet M0
    // mätte på, och medianen av den är det som säger om en bild är läst eller gissad.
    const rader: OcrRad[] = (resultat.results ?? []).map((r) => ({
      text: r.text,
      confidence: r.confidence,
    }));

    postMessage({
      typ: 'klar',
      id,
      niva,
      text: resultat.text ?? rader.map((r) => r.text).join('\n'),
      rader,
      ms: {
        avkoda: Math.round(t1 - t0),
        forbehandla: Math.round(t2 - t1),
        tolka: Math.round(t3 - t2),
        totalt: Math.round(t3 - t0),
      },
      bild: { bredd, hojd },
    } satisfies OcrSvar);
  } catch (fel) {
    postMessage({ typ: 'fel', id, niva, meddelande: (fel as Error).message } satisfies OcrSvar);
  }
});
