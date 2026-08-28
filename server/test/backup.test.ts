import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Archive } from "../src/store/archive.js";
import { ulid } from "../src/store/ulid.js";
import { receiptDir } from "../src/store/paths.js";
import { BackupJob } from "../src/backup/job.js";
import { readManifest, verify } from "../src/backup/mirror.js";
import { count } from "../src/store/index-db.js";

const jpeg = (w = 400, h = 600): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#dddddd" } }).jpeg().toBuffer();

describe("säkerhetskopiering", () => {
  let data: string;
  let backup: string;

  beforeEach(async () => {
    data = await mkdtemp(join(tmpdir(), "receipt-trackr-data-"));
    backup = await mkdtemp(join(tmpdir(), "receipt-trackr-backup-"));
  });
  afterEach(async () => {
    await rm(data, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
  });

  async function seed(n: number): Promise<string[]> {
    const archive = Archive.open(data);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = ulid();
      ids.push(id);
      await archive.create({ id });
      await archive.addSegment(id, 1, await jpeg());
    }
    archive.close();
    return ids;
  }

  it("kopierar arkivet och kontrollerar kopian i samma körning", async () => {
    await seed(3);
    const summary = await new BackupJob(data, backup).run();

    expect(summary.ok).toBe(true);
    expect(summary.receipts).toBe(3);
    // segment, sidecar och tumnagel per kvitto
    expect(summary.files).toBe(9);
    expect(summary.copied).toBe(9);
    expect(summary.verify?.missing).toEqual([]);
    expect(summary.verify?.corrupt).toEqual([]);
  });

  it("kopierar inte om bilder som redan ligger i kopian, men alltid sidecaren", async () => {
    const [id] = await seed(2);
    await new BackupJob(data, backup).run();

    // Sidecaren ändras när ett fält rättas; bilderna ändras aldrig.
    const sidecar = join(receiptDir(data, id!), "receipt.json");
    const receipt = JSON.parse(await readFile(sidecar, "utf8")) as Record<string, unknown>;
    receipt["text"] = "BAUHAUS\nATT BETALA 419,00";
    await writeFile(sidecar, JSON.stringify(receipt, null, 2));

    const second = await new BackupJob(data, backup).run();
    expect(second.ok).toBe(true);
    expect(second.copied).toBe(2); // två sidecar-filer
    expect(second.skipped).toBe(4); // fyra bilder
  });

  it("kopierar aldrig sökindexet — det är härlett och byggs om", async () => {
    await seed(1);
    await new BackupJob(data, backup).run();
    const manifest = await readManifest(join(backup, "MANIFEST.json"));
    expect(manifest.entries.some((e) => e.path.includes("index.sqlite"))).toBe(false);
  });

  it("upptäcker en fil som blivit trasig i kopian", async () => {
    await seed(1);
    const job = new BackupJob(data, backup);
    await job.run();

    const manifest = await readManifest(join(backup, "MANIFEST.json"));
    const image = manifest.entries.find((e) => e.path.endsWith("segment-01.jpg"))!;
    await writeFile(join(backup, image.path), "ruttna bytes");

    const result = await job.verifyAgainstManifest();
    expect(result.ok).toBe(false);
    expect(result.corrupt).toEqual([image.path]);
  });

  it("upptäcker en fil som saknas i kopian", async () => {
    await seed(1);
    const job = new BackupJob(data, backup);
    await job.run();
    const manifest = await readManifest(join(backup, "MANIFEST.json"));
    await rm(join(backup, manifest.entries[0]!.path));

    const result = await job.verifyAgainstManifest();
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(1);
  });

  /**
   * Återställningsövningen (krav 40, 56), som test: kopiera, radera arkivet, kopiera
   * tillbaka, bygg om indexet — och kontrollera att både filer och sökbarhet är kvar.
   * Det är den här kedjan som måste ha gått igenom på riktigt innan papper slängs.
   */
  it("återställning: allt kommer tillbaka och indexet byggs om", async () => {
    const ids = await seed(3);
    const job = new BackupJob(data, backup);
    await job.run();

    await rm(join(data, "receipts"), { recursive: true, force: true });
    await rm(join(data, "index.sqlite"), { force: true });

    const { cp } = await import("node:fs/promises");
    await cp(join(backup, "receipts"), join(data, "receipts"), { recursive: true });

    const manifest = await readManifest(join(backup, "MANIFEST.json"));
    const restored = await verify(data, manifest);
    expect(restored.ok).toBe(true);
    expect(restored.checked).toBe(manifest.files);

    const archive = Archive.open(data);
    try {
      const { indexed } = await archive.reindex();
      expect(indexed).toBe(3);
      expect(count(archive.db)).toBe(3);
      for (const id of ids) expect(await archive.get(id)).not.toBeNull();
    } finally {
      archive.close();
    }
  });
});
