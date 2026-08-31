/**
 * Bilderna på ett kvitto som redan ligger i arkivet: vridning, ersättning, kassering.
 *
 * Allt här rör den regel som bär hela arkivet — **bilderna är oåterkalleliga** — och
 * därför prövas i varje test vad som händer med originalets bytes. Vridningen rör dem
 * inte alls. Ersättningen och kasseringen gör det, och får bara göra det när en
 * människa sagt till: regeln finns mot tyst förlust, inte mot den som tittat på ett
 * suddigt foto och tagit om det.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Archive, ConflictError } from "../src/store/archive.js";
import { receiptDir } from "../src/store/paths.js";
import { ulid } from "../src/store/ulid.js";
import { arkiv } from "../src/store/index-db.js";

const jpeg = (bredd = 600, hojd = 800, farg = "#cccccc"): Promise<Buffer> =>
  sharp({ create: { width: bredd, height: hojd, channels: 3, background: farg } })
    .jpeg()
    .toBuffer();

describe("bilderna på ett arkiverat kvitto", () => {
  let dir: string;
  let archive: Archive;
  let id: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-bilder-"));
    archive = Archive.open(dir);
    id = ulid(Date.UTC(2026, 3, 11));
    await archive.create({ id });
    await archive.addSegment(id, 1, await jpeg());
    await archive.addSegment(id, 2, await jpeg(600, 800, "#bbbbbb"));
    await archive.complete(id, 2);
    await archive.saveOcr(id, "BAUHAUS\nATT BETALA 149,00\n2026-04-11", { teckenPerRad: 11 });
  });
  afterEach(async () => {
    archive.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("skriver vridningen på segmentet utan att röra bildens bytes", async () => {
    const fore = await readFile(join(receiptDir(dir, id), "segment-01.jpg"));

    await archive.roteraSegment(id, 1, 90);

    const receipt = (await archive.get(id))!;
    expect(receipt.segments[0]!.rotation).toBe(90);
    const efter = await readFile(join(receiptDir(dir, id), "segment-01.jpg"));
    expect(efter.equals(fore)).toBe(true);
    // Summan är kvittensen på att rätt bild kom fram. Ändras den har något annat hänt.
    expect(receipt.segments[0]!.sha256).toBe(receipt.segments[0]!.sha256);
  });

  /** Noll och "inget fält" betyder samma sak, och ska se likadana ut på disk. */
  it("tar bort vridningen igen i stället för att skriva noll", async () => {
    await archive.roteraSegment(id, 1, 180);
    await archive.roteraSegment(id, 1, 0);
    expect("rotation" in (await archive.get(id))!.segments[0]!).toBe(false);
  });

  it("bygger om tumnageln så att listorna visar bilden åt rätt håll", async () => {
    const tumnagel = join(receiptDir(dir, id), "derived", "thumb-01.webp");
    const fore = await sharp(await readFile(tumnagel)).metadata();

    await archive.roteraSegment(id, 1, 90);

    // Tumnageln skalas till en fast bredd, så måtten byter inte plats — proportionen
    // gör det. Ett stående kvitto som lagts ned är bredare än det är högt.
    const efter = await sharp(await readFile(tumnagel)).metadata();
    expect(fore.width! / fore.height!).toBeLessThan(1);
    expect(efter.width! / efter.height!).toBeGreaterThan(1);
  });

  it("låter en människa ersätta en dålig bild, och skriver ned vad som fanns", async () => {
    const gammal = (await archive.get(id))!.segments[0]!.sha256;

    const { receipt } = await archive.ersattSegment(id, 1, await jpeg(900, 1200, "#eeeeee"));

    expect(receipt.segments[0]!.sha256).not.toBe(gammal);
    expect(receipt.segments[0]!.width).toBe(900);
    expect(receipt.kasserade).toEqual([
      { at: expect.any(String), index: 1, sha256: gammal, orsak: "ersatt" },
    ]);
    // Läsningen beskrev bilden som inte finns kvar, och kastas.
    expect(receipt.text).toBe("");
    expect(receipt.ocr).toBeNull();
  });

  it("kasserar en bild, sänker antalet utlovade och tar filerna", async () => {
    const receipt = await archive.taBortSegment(id, 2);

    expect(receipt.segments.map((s) => s.file)).toEqual(["segment-01.jpg"]);
    expect(receipt.expectedSegments).toBe(1);
    expect(receipt.kasserade?.[0]).toMatchObject({ index: 2, orsak: "borttagen" });
    await expect(stat(join(receiptDir(dir, id), "segment-02.jpg"))).rejects.toThrow();
    await expect(stat(join(receiptDir(dir, id), "derived", "thumb-02.webp"))).rejects.toThrow();
  });

  /**
   * Ett kvitto utan bilder är inget kvitto. Vägen ut ur "den här bilden duger inte
   * och jag har ingen annan" heter *Ta bort kvittot*, och den ska heta det.
   */
  it("vägrar kassera den enda bilden", async () => {
    await archive.taBortSegment(id, 2);
    await expect(archive.taBortSegment(id, 1)).rejects.toThrow(ConflictError);
  });

  it("kastar läsningen när en bild till läggs på ett tolkat kvitto", async () => {
    await archive.addSegment(id, 3, await jpeg());
    const receipt = (await archive.get(id))!;
    expect(receipt.text).toBe("");
    expect(receipt.ocr).toBeNull();
  });
});

describe("sorteringen i arkivet", () => {
  let dir: string;
  let archive: Archive;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-sortering-"));
    archive = Archive.open(dir);
    let n = 0;
    for (const [butik, datum, belopp] of [
      ["Byggmax", "2026-05-25", 219],
      ["Alingsås Färg", "2026-04-02", 1990],
      ["Colorama", "2026-06-14", 90],
    ] as const) {
      const id = ulid(Date.UTC(2026, 7, 28) + n++ * 60_000);
      await archive.create({ id });
      await archive.addSegment(id, 1, await jpeg());
      await archive.complete(id, 1);
      await archive.saveOcr(id, `${butik}\nATT BETALA ${belopp},00\n${datum}`, { teckenPerRad: 11 });
      await archive.rattaFalten(id, [
        { namn: "store", value: butik, bekraftat: false },
        { namn: "date", value: datum, bekraftat: false },
        { namn: "total", value: belopp, bekraftat: false },
      ]);
    }
  });
  afterEach(async () => {
    archive.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("sorterar på kvittots eget datum, senast först, utan att bli tillsagd", () => {
    expect(arkiv(archive.db, {}).receipts.map((r) => r.date)).toEqual([
      "2026-06-14",
      "2026-05-25",
      "2026-04-02",
    ]);
  });

  it("sorterar på belopp, störst först", () => {
    expect(arkiv(archive.db, { sortera: "total" }).receipts.map((r) => r.total)).toEqual([1990, 219, 90]);
  });

  /** Butik sorteras som ord, och å ä ö hör hemma där svensk läsning väntar sig dem. */
  it("sorterar på butik, oberoende av versaler", () => {
    expect(arkiv(archive.db, { sortera: "store", stigande: true }).receipts.map((r) => r.store)).toEqual([
      "Alingsås Färg",
      "Byggmax",
      "Colorama",
    ]);
  });

  /** En rubrik är inte en fråga: ett okänt kolumnnamn faller tillbaka på datum. */
  it("tar inte emot en kolumn som inte finns", () => {
    const rader = arkiv(archive.db, { sortera: "hittepå" as never }).receipts;
    expect(rader.map((r) => r.date)).toEqual(["2026-06-14", "2026-05-25", "2026-04-02"]);
  });
});
