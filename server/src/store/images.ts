/**
 * Segmentens bytes är originalet och rörs aldrig (krav 4): de skrivs precis som de
 * kom från telefonen, och sha256 räknas på exakt de bytes som hamnar på disk. Allt
 * som härleds — tumnaglar — hamnar i `derived/` och får slängas när som helst.
 */
import { createHash } from "node:crypto";
import { open, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { derivedDir, receiptDir, segmentName, thumbName } from "./paths.js";
import type { Rotation, Segment } from "./sidecar.js";

export const THUMB_WIDTH = 480;

export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Samma atomiska mönster som sidecaren: en halvskriven bild ska aldrig kunna ses. */
async function writeAtomic(target: string, bytes: Buffer): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(bytes);
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
}

export class ImageError extends Error {}

/**
 * Skriver ett segment och dess tumnagel, och svarar med posten som ska in i
 * sidecaren. Bilden avkodas bara för att läsa måtten och göra tumnageln — bytesen
 * som sparas är oförändrade.
 */
export async function saveSegment(
  dataDir: string,
  id: string,
  index: number,
  bytes: Buffer,
  capture?: Record<string, unknown>,
): Promise<Segment> {
  let meta;
  try {
    // autoOrient: måtten ska vara de en människa ser, inte sensorns. Uppräteningen
    // av själva bilden hör till OCR-steget (M5) och rör aldrig originalfilen.
    meta = await sharp(bytes, { autoOrient: true }).metadata();
  } catch (cause) {
    throw new ImageError(`Går inte att läsa som bild: ${(cause as Error).message}`);
  }
  if (!meta.width || !meta.height) throw new ImageError("Bilden saknar mått.");

  const dir = receiptDir(dataDir, id);
  await mkdir(join(dir, "derived"), { recursive: true });

  const file = segmentName(index);
  await writeAtomic(join(dir, file), bytes);

  await skrivTumnagel(dataDir, id, index, bytes, 0);

  return {
    file,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    width: meta.width,
    height: meta.height,
    ...(capture ? { capture } : {}),
  };
}

/**
 * Tumnageln, byggd ur originalets bytes.
 *
 * Den är härledd och får kastas när som helst — därför byggs den om i stället för att
 * vridas: en bild som vridits fyra gånger ska vara exakt den den var, inte fyra
 * omkodningar senare.
 */
export async function skrivTumnagel(
  dataDir: string,
  id: string,
  index: number,
  bytes: Buffer,
  rotation: Rotation,
): Promise<void> {
  const thumb = await sharp(bytes, { autoOrient: true })
    .rotate(rotation)
    .resize({ width: THUMB_WIDTH, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await mkdir(derivedDir(dataDir, id), { recursive: true });
  await writeAtomic(join(derivedDir(dataDir, id), thumbName(index)), thumb);
}
