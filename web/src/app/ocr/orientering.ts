/**
 * Uppräteningsregeln ur M0, portad till canvas.
 *
 * Regeln finns därför att EXIF inte räcker: 91 % av bilderna i backloggen saknar
 * taggen helt, och en bild som ligger ned läses tecken för tecken eller inte alls.
 * Felet är dessutom osynligt i det ena ledet — webbläsaren visar bilden upprätt tack
 * vare taggen den inte har, medan OCR:en läser pixlarna som de ligger.
 *
 * Regeln har två halvor, och båda mättes fram:
 *
 *   **Om** sidan ligger ned avgörs på formen. Andelen textrutor som är högre än breda
 *   låg på 0,86 för liggande bilder och 0 för stående, så tröskeln 0,5 skiljer dem åt
 *   utan att någon behöver läsa bilden.
 *
 *   **Åt vilket håll** går inte att se på formen — 90° och 270° ser likadana ut. Det
 *   avgörs av en provläsning åt båda hållen, där medelkonfidensen skilde 0,95 mot 0,58
 *   på samma hög. Provläsningen behöver bara några hela rader, inte hela sidan; men är
 *   marginalen mellan hållen under 0,05 vilar valet inte på något, och då läses sidan
 *   om i sin helhet.
 */

export type Box = { x: number; y: number; width: number; height: number };

/** Tröskeln som skiljer liggande från stående. Mätt: 0,86 mot 0. */
const LIGGANDE_TROSKEL = 0.5;
/** Under den här marginalen vilar riktningsvalet inte på något. Mätt kostnad: en omläsning. */
const MARGINAL = 0.05;
/** Så många hela rader provläsningen behöver. Fler kostar tid utan att ge säkrare svar. */
const PROV_RADER = 6;

export type Orientering = {
  rotation: 0 | 90 | 180 | 270;
  /** Andelen textrutor som är högre än breda. Det är den som avgör *om*. */
  hogaAndel: number;
  /** Medelkonfidens för det valda hållet. `null` när bilden stod upp från början. */
  konfidens: number | null;
  kandidater: Record<number, number> | null;
  marginal: number | null;
  /** Två svaga kandidater: valet vilar inte på något och bilden ska granskas. */
  osaker: boolean;
  prov: 'ingen' | 'remsa' | 'hel';
  eskalerad: boolean;
  ms: number;
};

export function roteraDuk(kalla: OffscreenCanvas | ImageBitmap, grader: 0 | 90 | 180 | 270): OffscreenCanvas {
  const bredd = 'width' in kalla ? kalla.width : 0;
  const hojd = 'height' in kalla ? kalla.height : 0;
  const vand = grader === 90 || grader === 270;
  const duk = new OffscreenCanvas(vand ? hojd : bredd, vand ? bredd : hojd);
  const ctx = duk.getContext('2d')!;
  ctx.translate(duk.width / 2, duk.height / 2);
  ctx.rotate((grader * Math.PI) / 180);
  ctx.drawImage(kalla as CanvasImageSource, -bredd / 2, -hojd / 2);
  return duk;
}

/**
 * Klipper ut en remsa med ett par hela textrader ur en sida som ligger ned. På en
 * vriden sida löper raderna lodrätt genom bilden, så en remsa i x-led ger några
 * kompletta rader medan en i y-led hade gett stumpar av alla.
 */
export function provremsa(kalla: OffscreenCanvas, boxes: Box[]): OffscreenCanvas | null {
  const hoga = boxes.filter((b) => b.height > b.width).sort((a, b) => a.x - b.x);
  if (hoga.length <= PROV_RADER) return null;
  // En bit in från kanten: kvittots början och slut är glesare än mitten.
  const start = Math.floor(hoga.length * 0.25);
  const fonster = hoga.slice(start, start + PROV_RADER);
  const marginal = 8;
  const vanster = Math.max(0, Math.floor(Math.min(...fonster.map((b) => b.x)) - marginal));
  const hoger = Math.min(kalla.width, Math.ceil(Math.max(...fonster.map((b) => b.x + b.width)) + marginal));
  if (hoger - vanster < 16) return null;

  const duk = new OffscreenCanvas(hoger - vanster, kalla.height);
  duk.getContext('2d')!.drawImage(kalla, vanster, 0, duk.width, duk.height, 0, 0, duk.width, duk.height);
  return duk;
}

type Las = (duk: OffscreenCanvas) => Promise<{ results?: { text: string; confidence: number }[] }>;

/** Läser samma bild åt båda hållen och svarar med medelkonfidensen för vardera. */
async function provlas(las: Las, kalla: OffscreenCanvas): Promise<{ grader: 90 | 270; konfidens: number }[]> {
  const ut: { grader: 90 | 270; konfidens: number }[] = [];
  for (const grader of [90, 270] as const) {
    const svar = await las(roteraDuk(kalla, grader));
    const konf = (svar.results ?? [])
      .filter((r) => r.text.trim().length > 0)
      .map((r) => r.confidence)
      .filter((c) => Number.isFinite(c));
    ut.push({ grader, konfidens: konf.length ? konf.reduce((a, b) => a + b, 0) / konf.length : 0 });
  }
  return ut;
}

const spann = (s: { konfidens: number }[]): number => Math.abs(s[0]!.konfidens - s[1]!.konfidens);

export async function kalibrera(
  duk: OffscreenCanvas,
  detektera: (d: OffscreenCanvas) => Promise<{ boxes: Box[] }>,
  las: Las,
): Promise<Orientering> {
  const t0 = performance.now();
  const { boxes } = await detektera(duk);
  const hogaAndel = boxes.length ? boxes.filter((b) => b.height > b.width).length / boxes.length : 0;

  const bas: Orientering = {
    rotation: 0,
    hogaAndel: Math.round(hogaAndel * 100) / 100,
    konfidens: null,
    kandidater: null,
    marginal: null,
    osaker: false,
    prov: 'ingen',
    eskalerad: false,
    ms: 0,
  };

  if (hogaAndel <= LIGGANDE_TROSKEL) {
    bas.ms = Math.round(performance.now() - t0);
    return bas;
  }

  const remsa = provremsa(duk, boxes);
  let prov: 'remsa' | 'hel' = remsa ? 'remsa' : 'hel';
  let poang = await provlas(las, remsa ?? duk);
  let eskalerad = false;

  if (remsa && spann(poang) < MARGINAL) {
    poang = await provlas(las, duk);
    prov = 'hel';
    eskalerad = true;
  }

  const bast = poang.reduce((a, b) => (a.konfidens >= b.konfidens ? a : b));
  return {
    ...bas,
    rotation: bast.grader,
    konfidens: Math.round(bast.konfidens * 1000) / 1000,
    kandidater: Object.fromEntries(poang.map((p) => [p.grader, Math.round(p.konfidens * 1000) / 1000])),
    marginal: Math.round(spann(poang) * 1000) / 1000,
    // Två svaga kandidater betyder att valet inte vilar på någonting. Det ska synas.
    osaker: bast.konfidens < 0.5,
    prov,
    eskalerad,
    ms: Math.round(performance.now() - t0),
  };
}
