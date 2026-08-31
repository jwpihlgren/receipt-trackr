/**
 * Analysen och kategorierna.
 *
 * Två saker prövas hårdare än resten. **Ett köp räknas en gång** — tre foton av samma
 * kvitto är inte tre utgifter, och en summa som räknar fotografier ser bara ut som att
 * man handlat mer. Och **regeln gäller bakåt**: säger man att Colorama är bygg och färg
 * byter alla kvitton därifrån kategori, för kategorin är härledd och inte inskriven på
 * vart och ett av dem.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Archive } from "../src/store/archive.js";
import { ulid } from "../src/store/ulid.js";
import { analys } from "../src/store/index-db.js";
import { KATEGORIER_FILE, kategoriFor, standard, OVRIGT } from "../src/store/kategorier.js";
import { readFileSync } from "node:fs";

/** Beställarens egna kvittotexter — de bär de nummer som gör en dubblett bevisbar. */
const { kvitton } = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/kvitton.json"), "utf8"),
) as { kvitton: { fil: string; text: string }[] };

const jpeg = (): Promise<Buffer> =>
  sharp({ create: { width: 600, height: 800, channels: 3, background: "#cccccc" } }).jpeg().toBuffer();

describe("kategorin följer butiken", () => {
  it("delar in de kedjor appen redan känner igen", () => {
    const k = standard();
    expect(kategoriFor(k, "Byggmax")).toBe("Bygg och färg");
    expect(kategoriFor(k, "Systembolaget")).toBe("Mat och dryck");
    expect(kategoriFor(k, "Däckskiftarna")).toBe("Bil");
  });

  /** Butiksnamnet i arkivet bär ofta orten: "Bauhaus Kungens Kurva" är Bauhaus. */
  it("hittar kedjan inuti ett längre butiksnamn", () => {
    expect(kategoriFor(standard(), "Bauhaus Kungens Kurva")).toBe("Bygg och färg");
  });

  /** Ett namn som *innehåller* bokstäverna är inte kedjan. Preem finns inte i Premium. */
  it("tar inte en kedja som råkar stå inuti ett annat ord", () => {
    expect(kategoriFor(standard(), "Premium Fönster AB")).toBe(OVRIGT);
  });

  it("lämnar det okända i Övrigt i stället för att gissa", () => {
    expect(kategoriFor(standard(), "Lundgrens Järnhandel")).toBe(OVRIGT);
    expect(kategoriFor(standard(), null)).toBe(OVRIGT);
  });
});

describe("analysen", () => {
  let dir: string;
  let archive: Archive;
  let n = 0;

  /** Ett färdigt kvitto med butik, datum och belopp satta för hand. */
  async function kop(butik: string, datum: string, belopp: number): Promise<string> {
    const id = ulid(Date.UTC(2026, 7, 28) + n++ * 60_000);
    await archive.create({ id });
    await archive.addSegment(id, 1, await jpeg());
    await archive.complete(id, 1);
    await archive.saveOcr(id, `${butik}\n${datum}\nATT BETALA ${belopp},00`, { teckenPerRad: 11 });
    await archive.rattaFalten(id, [
      { namn: "store", value: butik, bekraftat: false },
      { namn: "date", value: datum, bekraftat: false },
      { namn: "total", value: belopp, bekraftat: false },
    ]);
    return id;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-analys-"));
    archive = Archive.open(dir);
    n = 0;
  });
  afterEach(async () => {
    archive.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("summerar perioden per månad och per kategori", async () => {
    await kop("Byggmax", "2026-04-20", 2000);
    await kop("Colorama", "2026-04-17", 500);
    await kop("Systembolaget", "2026-05-05", 300);

    const svar = analys(archive.db, "2026-01-01", "2026-12-31");
    expect(svar.summa).toBe(2800);
    expect(svar.antal).toBe(3);
    expect(svar.manader.map((m) => [m.manad, m.summa])).toEqual([
      ["2026-04", 2500],
      ["2026-05", 300],
    ]);
    expect(svar.kategorier).toEqual([
      { kategori: "Bygg och färg", summa: 2500, antal: 2, forra: null },
      { kategori: "Mat och dryck", summa: 300, antal: 1, forra: null },
    ]);
  });

  /**
   * Dubbletterna. Två foton av samma köp är ett köp — annars vore varje omtagning en
   * utgift till, och just den sortens fel syns aldrig i en summa.
   *
   * Texterna är beställarens egna foton av samma Colorama-kvitto. Två *påhittade*
   * köp på samma dag och samma summa hade inte dugt som prov: matchningen vägrar med
   * flit slå ihop dem, eftersom två köp i samma butik samma dag är fullt möjliga.
   */
  it("räknar ett köp en gång även när det fotograferats tre gånger", async () => {
    for (const fil of ["colorama-90-a", "colorama-90-b", "colorama-90-c"]) {
      const kvitto = kvitton.find((k) => k.fil === fil)!;
      const id = ulid(Date.UTC(2026, 7, 28) + n++ * 60_000);
      await archive.create({ id, capturedAt: "2026-08-28T12:47:00.000Z" });
      await archive.addSegment(id, 1, await jpeg());
      await archive.complete(id, 1);
      await archive.saveOcr(id, kvitto.text, { teckenPerRad: 11 });
    }

    const svar = analys(archive.db, "2026-01-01", "2026-12-31");
    expect(svar.antal).toBe(1);
    expect(svar.summa).toBe(90);
    expect(svar.kategorier[0]!.kategori).toBe("Bygg och färg");
  });

  it("jämför med föregående lika långa period, och säger null när den är tom", async () => {
    await kop("Byggmax", "2026-04-20", 1000);
    await kop("Byggmax", "2026-02-10", 400);

    // Mars–april har januari–februari bakom sig, och där finns ett köp.
    const med = analys(archive.db, "2026-03-01", "2026-04-30");
    expect(med.kategorier[0]).toMatchObject({ kategori: "Bygg och färg", summa: 1000, forra: 400 });

    // Januari–februari har november–december bakom sig, och där finns ingenting alls.
    const utan = analys(archive.db, "2026-01-01", "2026-02-28");
    expect(utan.kategorier[0]!.forra).toBeNull();
  });

  it("listar de största köpen med vägen tillbaka till kvittot", async () => {
    const stort = await kop("Däckskiftarna", "2026-05-11", 9425);
    await kop("Jula", "2026-05-12", 248.8);

    const svar = analys(archive.db, "2026-01-01", "2026-12-31");
    expect(svar.storsta[0]).toMatchObject({ id: stort, total: 9425, kategori: "Bil" });
  });

  /** Regeln gäller bakåt: kvitton som redan ligger i arkivet byter kategori. */
  it("räknar om gamla kvitton när en butik får en ny kategori", async () => {
    await kop("Lundgrens Järnhandel", "2026-04-20", 700);
    expect(analys(archive.db, "2026-01-01", "2026-12-31").kategorier[0]!.kategori).toBe(OVRIGT);

    await archive.sattRegel("Lundgrens Järnhandel", "Bygg och färg");

    expect(analys(archive.db, "2026-01-01", "2026-12-31").kategorier[0]!.kategori).toBe("Bygg och färg");
    const fil = JSON.parse(await readFile(join(dir, KATEGORIER_FILE), "utf8")) as { regler: Record<string, string> };
    expect(fil.regler["Lundgrens Järnhandel"]).toBe("Bygg och färg");
  });

  /** Kvittot från butiken som säljer allt: kategorin sätts på kvittot och vinner. */
  it("låter ett kvittos egen kategori väga tyngre än butikens regel", async () => {
    const id = await kop("Coop", "2026-04-20", 900);
    await archive.sattKategori(id, "Hem och trädgård");

    const svar = analys(archive.db, "2026-01-01", "2026-12-31");
    expect(svar.kategorier).toEqual([
      { kategori: "Hem och trädgård", summa: 900, antal: 1, forra: null },
    ]);

    // Och tillbaka: null lämnar kvittot till butikens regel igen.
    await archive.sattKategori(id, null);
    expect(analys(archive.db, "2026-01-01", "2026-12-31").kategorier[0]!.kategori).toBe("Mat och dryck");
  });

  /** Indexet är härlett: kategorierna ska överleva att filen kastas och byggs om. */
  it("bygger tillbaka kategorierna ur disken", async () => {
    await kop("Byggmax", "2026-04-20", 1000);
    await archive.sattRegel("Byggmax", "Verktyg");
    archive.close();

    await rm(join(dir, "index.sqlite"), { force: true });
    archive = Archive.open(dir);
    await archive.reindex();

    expect(analys(archive.db, "2026-01-01", "2026-12-31").kategorier[0]!.kategori).toBe("Verktyg");
  });
});
