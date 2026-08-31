import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Archive, ConflictError } from "../src/store/archive.js";
import { receiptDir, sidecarPath } from "../src/store/paths.js";
import { ulid } from "../src/store/ulid.js";
import { arkiv, count } from "../src/store/index-db.js";
import type { Receipt } from "../src/store/sidecar.js";

const jpeg = (width = 600, height = 800): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: "#cccccc" } }).jpeg().toBuffer();

describe("Archive", () => {
  let dir: string;
  let archive: Archive;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-archive-"));
    archive = Archive.open(dir);
  });
  afterEach(async () => {
    archive.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("lägger kvittot i år och månad ur ULID:en", async () => {
    const id = ulid(Date.UTC(2026, 3, 11));
    await archive.create({ id });
    expect(receiptDir(dir, id)).toBe(join(dir, "receipts", "2026", "04", id));
    expect((await stat(sidecarPath(dir, id))).isFile()).toBe(true);
  });

  it("är idempotent: samma ULID ger samma kvitto, inte ett andra", async () => {
    const id = ulid();
    const first = await archive.create({ id, capturedAt: "2026-04-11T10:00:00Z" });
    const second = await archive.create({ id, capturedAt: "2026-04-11T10:00:09Z" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    // Omtaget anropet får inte skriva över fångsttidpunkten på det som redan finns.
    expect(second.receipt.capturedAt).toBe("2026-04-11T10:00:00Z");
    expect(count(archive.db)).toBe(1);
  });

  it("vägrar en ULID som inte är en ULID", async () => {
    await expect(archive.create({ id: "inte-en-ulid" })).rejects.toThrow(/giltig ULID/);
  });

  it("sparar segmentets bytes orörda och räknar sha256 på dem", async () => {
    const id = ulid();
    await archive.create({ id });
    const bytes = await jpeg();
    const { segment } = await archive.addSegment(id, 1, bytes);

    const onDisk = await readFile(join(receiptDir(dir, id), "segment-01.jpg"));
    expect(onDisk.equals(bytes)).toBe(true);
    expect(segment.bytes).toBe(bytes.byteLength);
    expect(segment.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(segment).toMatchObject({ file: "segment-01.jpg", width: 600, height: 800 });
  });

  it("gör en tumnagel som är härledd och mindre än originalet", async () => {
    const id = ulid();
    await archive.create({ id });
    await archive.addSegment(id, 1, await jpeg(1600, 2000));

    const thumb = join(receiptDir(dir, id), "derived", "thumb-01.webp");
    const meta = await sharp(await readFile(thumb)).metadata();
    expect(meta.width).toBe(480);
    expect(meta.format).toBe("webp");
  });

  it("samma segment igen är en tystnad, ett annat innehåll är ett fel", async () => {
    const id = ulid();
    await archive.create({ id });
    const bytes = await jpeg();
    await archive.addSegment(id, 1, bytes);

    const again = await archive.addSegment(id, 1, bytes);
    expect(again.created).toBe(false);
    expect(again.receipt.segments).toHaveLength(1);

    // Bilderna är oåterkalleliga: ett annat innehåll får aldrig tyst ersätta ett original.
    await expect(archive.addSegment(id, 1, await jpeg(640, 480))).rejects.toThrow(ConflictError);
  });

  it("vägrar något som inte går att läsa som bild", async () => {
    const id = ulid();
    await archive.create({ id });
    await expect(archive.addSegment(id, 1, Buffer.from("inte en bild"))).rejects.toThrow(/Går inte att läsa som bild/);
  });

  it("vägrar segment till ett kvitto som inte finns", async () => {
    await expect(archive.addSegment(ulid(), 1, await jpeg())).rejects.toThrow(/finns inte/);
  });

  it("skriver sidecaren atomiskt: inga tmp-filer lämnas kvar", async () => {
    const id = ulid();
    await archive.create({ id });
    await archive.addSegment(id, 1, await jpeg());
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(receiptDir(dir, id))).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
  });
});

describe("reindex", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-reindex-"));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("bygger samma index från disken som växte fram inkrementellt", async () => {
    const archive = Archive.open(dir);
    const ids = [ulid(Date.UTC(2026, 0, 2)), ulid(Date.UTC(2026, 5, 9)), ulid(Date.UTC(2025, 11, 24))];
    for (const id of ids) await archive.create({ id });
    const before = count(archive.db);
    archive.close();

    // Indexet är härlett: kastas det ska det gå att bygga tillbaka utan förlust.
    await rm(join(dir, "index.sqlite"), { force: true });
    const rebuilt = Archive.open(dir);
    try {
      const { indexed, skipped } = await rebuilt.reindex();
      expect(indexed).toBe(before);
      expect(skipped).toEqual([]);
    } finally {
      rebuilt.close();
    }
  });

  it("hoppar över en trasig sidecar i stället för att stanna", async () => {
    const archive = Archive.open(dir);
    const good = ulid();
    await archive.create({ id: good });
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "receipts", "2026", "01", "TRASIG"), { recursive: true });
    await writeFile(join(dir, "receipts", "2026", "01", "TRASIG", "receipt.json"), "{ inte json");

    const { indexed, skipped } = await archive.reindex();
    archive.close();
    expect(indexed).toBe(1);
    expect(skipped).toHaveLength(1);
  });
});

describe("fritextsöket", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-sok-"));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("hittar över diakriter, som M0 kräver", async () => {
    const archive = Archive.open(dir);
    try {
      const id = ulid();
      const { receipt } = await archive.create({ id });
      // Så här ser OCR-texten ut i verkligheten: å blev ä. Sökningen måste ändå träffa.
      // Kvittot görs komplett — arkivfrågan visar bara klara kvitton, och ofärdiga
      // hör hemma i aktiviteten.
      const komplett: Receipt = {
        ...receipt,
        segments: [{ file: "segment-01.jpg", sha256: "x", bytes: 1, width: 1, height: 1 }],
        expectedSegments: 1,
        completedAt: new Date().toISOString(),
        ocr: { teckenPerRad: 11 },
        fields: {
          store: { value: "Bauhaus", confidence: 1, source: "ocr" },
          date: { value: "2026-04-11", confidence: 1, source: "ocr" },
          total: { value: 4218.5, confidence: 1, source: "ocr" },
        },
        text: "BAUHAUS\näterköp av kakel\nATT BETALA 4218,50",
      };
      const { upsert } = await import("../src/store/index-db.js");
      upsert(archive.db, komplett, archive.kategorier);

      const sok = (q: string) => arkiv(archive.db, { q }).receipts.map((r) => r.id);
      expect(sok('"återköp"')).toEqual([id]);
      expect(sok('"aterkop"')).toEqual([id]);
      expect(sok('"kakel"')).toHaveLength(1);
      expect(sok('"skruvmejsel"')).toHaveLength(0);
    } finally {
      archive.close();
    }
  });
});
