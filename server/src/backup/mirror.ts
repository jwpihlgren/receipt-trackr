/**
 * Säkerhetskopiering (krav 39, 40, 56).
 *
 * Bilderna är oföränderliga, och det är hela skälet till att kopieringen kan vara så
 * enkel: ett segment som redan ligger i kopian med rätt storlek behöver aldrig röras
 * igen. Sidecaren ändras däremot varje gång ett fält rättas eller texten läses om, så
 * den kopieras alltid. `index.sqlite` kopieras aldrig — det är härlett, och
 * återställning bygger om det med `reindex`. Att kopiera en databas som skrivs till
 * medan kopieringen pågår ger dessutom en fil man inte vet något om.
 *
 * Manifestet är poängen med hela övningen. Utan sha256 per fil är en säkerhetskopia
 * bara en förhoppning: den ser ut att finnas, och ingen vet om den går att läsa.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { RECEIPTS_DIR, SIDECAR_FILE } from "../store/paths.js";

export const MANIFEST_SCHEMA = "receipt-trackr/manifest@1";

export type ManifestEntry = { path: string; sha256: string; bytes: number };

export type Manifest = {
  schema: typeof MANIFEST_SCHEMA;
  createdAt: string;
  source: string;
  receipts: number;
  files: number;
  bytes: number;
  entries: ManifestEntry[];
};

export type Progress = { files: number; copied: number; bytes: number; receipts: number };

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** Alla filer under `receipts/` som hör till arkivet, i sorterad ordning. */
async function archiveFiles(dir: string): Promise<string[]> {
  const root = join(dir, RECEIPTS_DIR);
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    // Temporärfiler från en avbruten skrivning hör inte till arkivet.
    if (entry.includes(".tmp-")) continue;
    if ((await stat(join(root, entry))).isFile()) files.push(join(RECEIPTS_DIR, entry));
  }
  return files.sort();
}

export type MirrorResult = { manifest: Manifest; manifestPath: string; copied: number; skipped: number };

/**
 * Speglar arkivet till `backupDir` och skriver ett daterat manifest. `onProgress`
 * anropas löpande så att den som väntar ser att något händer — en kopiering av
 * tiotusen kvitton tar minuter, och en stillastående skärm går inte att skilja från
 * en hängd.
 */
export async function mirror(
  dataDir: string,
  backupDir: string,
  onProgress?: (progress: Progress) => void,
): Promise<MirrorResult> {
  const files = await archiveFiles(dataDir);
  const entries: ManifestEntry[] = [];
  const receipts = new Set<string>();
  let copied = 0;
  let skipped = 0;
  let bytes = 0;

  for (const relPath of files) {
    const from = join(dataDir, relPath);
    const to = join(backupDir, relPath);
    const source = await stat(from);

    // Sidecaren ändras över tid; bilderna gör det aldrig. Därför olika regler.
    const immutable = !relPath.endsWith(SIDECAR_FILE);
    const existing = await stat(to).catch(() => null);
    if (immutable && existing?.isFile() && existing.size === source.size) {
      skipped++;
    } else {
      await mkdir(dirname(to), { recursive: true });
      const tmp = `${to}.tmp-${process.pid}`;
      await copyFile(from, tmp);
      await rename(tmp, to);
      copied++;
    }

    // Summan räknas på kopian, inte på källan: det är kopian som ska gå att lita på.
    entries.push({ path: relPath, sha256: await sha256File(to), bytes: source.size });
    bytes += source.size;
    // Kvittots katalog är `receipts/<år>/<månad>/<ULID>`. Att ta dirname duger inte:
    // tumnaglarna ligger ett steg längre ned och skulle räknas som egna kvitton.
    receipts.add(relPath.split(sep).slice(0, 4).join(sep));
    onProgress?.({ files: entries.length, copied, bytes, receipts: receipts.size });
  }

  const manifest: Manifest = {
    schema: MANIFEST_SCHEMA,
    createdAt: new Date().toISOString(),
    source: dataDir,
    receipts: receipts.size,
    files: entries.length,
    bytes,
    entries,
  };
  await mkdir(backupDir, { recursive: true });
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = join(backupDir, `MANIFEST-${manifest.createdAt.slice(0, 10)}.json`);
  await writeFile(manifestPath, body, "utf8");
  // Alltid även under ett fast namn, så att kontrollen inte behöver veta dagens datum.
  await writeFile(join(backupDir, "MANIFEST.json"), body, "utf8");

  return { manifest, manifestPath, copied, skipped };
}

export type VerifyResult = { checked: number; missing: string[]; corrupt: string[]; extra: string[]; ok: boolean };

/**
 * Kontrollerar en katalog mot ett manifest. Det här är återställningsövningen i
 * kodform (krav 40): en kopia som inte kontrollerats är inte en kopia. Körs mot
 * `$BACKUP_DIR` för att kontrollera kopian, och mot `$DATA_DIR` efter en
 * återställning för att kontrollera att allt kom tillbaka.
 */
export async function verify(dir: string, manifest: Manifest): Promise<VerifyResult> {
  const missing: string[] = [];
  const corrupt: string[] = [];
  let checked = 0;

  for (const entry of manifest.entries) {
    const path = join(dir, entry.path);
    if (!(await stat(path).catch(() => null))?.isFile()) {
      missing.push(entry.path);
      continue;
    }
    checked++;
    if ((await sha256File(path)) !== entry.sha256) corrupt.push(entry.path);
  }

  // Filer som finns men inte står i manifestet är inte ett fel — men de är värda att
  // se, eftersom de betyder att kopian och manifestet är från olika tillfällen.
  const known = new Set(manifest.entries.map((e) => e.path));
  const extra = (await archiveFiles(dir)).filter((f) => !known.has(f));

  return { checked, missing, corrupt, extra, ok: missing.length === 0 && corrupt.length === 0 };
}

export async function readManifest(path: string): Promise<Manifest> {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(path, "utf8")) as Manifest;
}
