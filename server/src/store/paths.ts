/**
 * Sökvägarna i arkivet, på ett ställe. Layouten är en del av formatet och beskrivs
 * för en människa i ARKIVFORMAT.md — ändras den här måste den ändras där.
 *
 *   receipts/<år>/<månad>/<ULID>/segment-01.jpg
 *                               /receipt.json
 *                               /derived/thumb-01.webp
 */
import { join } from "node:path";
import { isUlid, ulidTime } from "./ulid.js";

export const RECEIPTS_DIR = "receipts";
export const SIDECAR_FILE = "receipt.json";
export const DERIVED_DIR = "derived";
export const INDEX_FILE = "index.sqlite";

export class InvalidIdError extends Error {}

/**
 * Katalogen för ett kvitto. Året och månaden tas ur ULID:ens tidsstämpel och inte ur
 * `capturedAt`: identiteten ska räcka för att hitta filen på disk, utan att först
 * behöva läsa något som ligger inuti den.
 */
export function receiptDir(dataDir: string, id: string): string {
  if (!isUlid(id)) throw new InvalidIdError(`"${id}" är inte en giltig ULID.`);
  const at = new Date(ulidTime(id));
  const year = String(at.getUTCFullYear());
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return join(dataDir, RECEIPTS_DIR, year, month, id);
}

export const sidecarPath = (dataDir: string, id: string): string => join(receiptDir(dataDir, id), SIDECAR_FILE);
export const derivedDir = (dataDir: string, id: string): string => join(receiptDir(dataDir, id), DERIVED_DIR);
export const indexPath = (dataDir: string): string => join(dataDir, INDEX_FILE);

/** `segment-01.jpg` — tvåsiffrigt så att filerna sorterar rätt i vilken filhanterare som helst. */
export const segmentName = (index: number): string => `segment-${String(index).padStart(2, "0")}.jpg`;
export const thumbName = (index: number): string => `thumb-${String(index).padStart(2, "0")}.webp`;

/** Filnamn utifrån får aldrig peka utanför kvittots katalog. */
export function isSafeFileName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".") && name !== "..";
}
