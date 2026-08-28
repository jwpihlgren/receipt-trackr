/**
 * `receipt.json` är sanningen om ett kvitto. Indexet är härlett och kan alltid byggas
 * om; sidecaren kan det inte. Därför gäller en enda regel för skrivordning, och den
 * finns här: **sidecar först, atomiskt, därefter indexet. Aldrig tvärtom.** Kraschar
 * det däremellan är disken korrekt och indexet efterblivet, vilket `reindex` löser.
 */
import { open, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { sidecarPath } from "./paths.js";

export const SCHEMA = "receipt-trackr/receipt@1";

export type Segment = {
  file: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  /** Mätvärden från kameran vid fångst; frivilliga, och klienten äger dem. */
  capture?: Record<string, unknown>;
};

export type Receipt = {
  schema: typeof SCHEMA;
  id: string;
  capturedAt: string;
  /** Gamla högen eller färskt kvitto — styr mätningen, se planens mätavsnitt. */
  backlog: boolean;
  segments: Segment[];
  /**
   * Hur många segment klienten säger att kvittot har, satt när användaren tryckt
   * "Klart". Utan den siffran går ett tappat andra segment inte att skilja från ett
   * kvitto som bara hade ett — och det är precis den tysta förlusten arkivet finns
   * för att förhindra. `null` betyder att fångsten fortfarande pågår.
   */
  expectedSegments: number | null;
  completedAt: string | null;
  fields: Record<string, unknown>;
  corrections: unknown[];
  review: { sampled: boolean };
  ocr: unknown | null;
  tags: { user: string[]; auto: string[] };
  /** Hela råtexten, radbruten. Fylls av OCR-steget i M5. */
  text: string;
};

export function newReceipt(id: string, capturedAt: string, backlog: boolean): Receipt {
  return {
    schema: SCHEMA,
    id,
    capturedAt,
    backlog,
    segments: [],
    expectedSegments: null,
    completedAt: null,
    fields: {},
    corrections: [],
    review: { sampled: false },
    ocr: null,
    tags: { user: [], auto: [] },
    text: "",
  };
}

export async function readSidecar(dataDir: string, id: string): Promise<Receipt | null> {
  try {
    return JSON.parse(await readFile(sidecarPath(dataDir, id), "utf8")) as Receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * tmp → fsync → rename. `fsync` är det som gör skillnad vid strömavbrott: utan den
 * kan `rename` bli synlig medan innehållet ännu inte nått disken, och då står det en
 * tom eller halv fil där sanningen om ett kvitto ska ligga.
 */
export async function writeSidecar(dataDir: string, receipt: Receipt): Promise<string> {
  const target = sidecarPath(dataDir, receipt.id);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  // Även katalogposten behöver nå disken för att bytet ska överleva ett strömavbrott.
  const dir = await open(dirname(target), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
  return target;
}
