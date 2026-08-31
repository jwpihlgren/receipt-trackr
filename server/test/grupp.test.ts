/**
 * Grupperna i arkivet: hela vägen från sidecar till lista.
 *
 * `matchning.test.ts` och `rostning.test.ts` prövar reglerna för sig, på texterna.
 * Det här testet prövar att arkivet **använder** dem: att tre foton av samma papper
 * blir ett köp i listan, att det kapade fotot får sitt butiksnamn av syskonen, och att
 * en grupp som mister en medlem räknas om i stället för att bli halv.
 *
 * Texterna är beställarens egna, ur `fixtures/kvitton.json`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Archive } from "../src/store/archive.js";
import { ulid } from "../src/store/ulid.js";
import { arkiv, ftsQuery, gruppFor, ofardiga } from "../src/store/index-db.js";

type Kvitto = { fil: string; text: string };
const { kvitton } = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/kvitton.json"), "utf8"),
) as { kvitton: Kvitto[] };

const jpeg = (): Promise<Buffer> =>
  sharp({ create: { width: 600, height: 800, channels: 3, background: "#cccccc" } }).jpeg().toBuffer();

/** Fotografierna togs 2026-08-28. Ett kvitto daterat efter fångsten förkastas. */
const FOTAT = Date.UTC(2026, 7, 28, 12, 45, 0);

describe("kvitton som visar samma köp", () => {
  let dir: string;
  let archive: Archive;
  let nasta = 0;

  /**
   * Lägger in en fixtur som ett färdigfångat, tolkat kvitto. `teckenPerRad` sätts till
   * normalfallets 11 så att kvittot inte fastnar på kvalitetsflaggan — det är gruppen
   * som prövas här, inte skärpan.
   */
  async function lagg(fil: string): Promise<string> {
    const kvitto = kvitton.find((k) => k.fil === fil);
    if (!kvitto) throw new Error(`Fixturen ${fil} finns inte.`);
    // Fångsttiden räknas upp per kvitto, så ULID-ordningen är densamma som ordningen
    // de läggs in i. Gruppens id är dess minsta medlem, alltså den först fångade.
    const id = ulid(FOTAT + nasta++ * 60_000);
    await archive.create({ id, capturedAt: new Date(FOTAT + nasta * 60_000).toISOString() });
    await archive.addSegment(id, 1, await jpeg());
    await archive.complete(id, 1);
    await archive.saveOcr(id, kvitto.text, { teckenPerRad: 11 });
    return id;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-grupp-"));
    archive = Archive.open(dir);
    nasta = 0;
  });
  afterEach(async () => {
    archive.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("gör tre foton av samma kvitto till ett köp i arkivet", async () => {
    await lagg("colorama-90-a");
    await lagg("colorama-90-b");
    await lagg("colorama-90-c");

    const { total, receipts } = arkiv(archive.db, {});
    expect(total).toBe(1);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.medlemmar).toBe(3);
    expect(receipts[0]!.store).toBe("Colorama");
    expect(receipts[0]!.total).toBe(90);
    // Bilderna är köpets, inte det företrädande fotografiets: en rad som sagt
    // "1 bild" om ett köp med tre hade sett ut att ha tappat två.
    expect(receipts[0]!.segments).toBe(3);
  });

  /**
   * Fotot som började mitt i momsraden läser ingen butik alls. Sidecaren ska säga
   * precis det — den är vad *den här bilden* gav — medan skärmen visar köpets butik.
   */
  it("ger det kapade fotot butiken från sina syskon, utan att röra dess sidecar", async () => {
    await lagg("colorama-90-a");
    const kapat = await lagg("colorama-90-b");
    await lagg("colorama-90-c");

    const pa_disken = await archive.get(kapat);
    expect((pa_disken!.fields as { store?: unknown }).store).toBeUndefined();

    const gruppen = gruppFor(archive.db, kapat)!;
    expect(gruppen.grupp).not.toBeNull();
    expect(gruppen.medlemmar).toHaveLength(3);
    expect((gruppen.falt.store as { value: string }).value).toBe("Colorama");
  });

  /**
   * Ensamt är det kapade fotot ett kvitto utan butik, och står i aktiviteten med en
   * uppgift åt beställaren. Med sina syskon är luckan fylld av maskinen själv — och
   * det är hela skälet att gruppera: han ska inte skriva in något en annan bild redan
   * har sagt.
   */
  it("lyfter kvittot ur aktiviteten när gruppen fyllt luckan", async () => {
    const kapat = await lagg("colorama-90-b");
    expect(ofardiga(archive.db).map((r) => r.id)).toContain(kapat);
    expect(ofardiga(archive.db).find((r) => r.id === kapat)!.lage).toBe("saknar_falt");

    await lagg("colorama-90-a");
    expect(ofardiga(archive.db)).toEqual([]);
  });

  /** Kvittot och kortslippen är två papper. Köpet är ett. */
  it("binder ihop kvittot med sin kortslipp", async () => {
    const kvittot = await lagg("flugger-722-kvitto");
    const slippen = await lagg("flugger-722-slip");

    expect(gruppFor(archive.db, kvittot)!.grupp).toBe(gruppFor(archive.db, slippen)!.grupp);
    expect(arkiv(archive.db, {}).receipts).toHaveLength(1);
  });

  /** Två köp i samma butik samma dag är två köp, hur lika de än ser ut. */
  it("håller isär två köp i samma butik samma dag", async () => {
    await lagg("byggmax-219");
    await lagg("byggmax-438");

    const { total, receipts } = arkiv(archive.db, {});
    expect(total).toBe(2);
    expect(receipts.map((r) => r.total).sort()).toEqual([219, 438]);
    expect(receipts.every((r) => r.grupp === null)).toBe(true);
  });

  /**
   * Rättar man butiken på ett foto gäller den köpet, inte fotografiet. Annars hade
   * samma kvitto kunnat visa två olika butiksnamn beroende på vilken bild man öppnade.
   */
  it("låter en människas ord gälla hela gruppen", async () => {
    const forsta = await lagg("colorama-90-a");
    const kapat = await lagg("colorama-90-b");

    await archive.rattaFalt(forsta, "store", "Colorama Kungsbacka", false);

    const falt = gruppFor(archive.db, kapat)!.falt.store as { value: string; source: string };
    expect(falt.value).toBe("Colorama Kungsbacka");
    expect(falt.source).toBe("manual");
    expect(arkiv(archive.db, {}).receipts[0]!.store).toBe("Colorama Kungsbacka");
  });

  /**
   * En raderad medlem får inte lämna kvar en halv grupp. Blir ett kvitto ensamt igen
   * ska det också tappa det gruppen gav det — annars stod ett butiksnamn kvar som
   * ingen bild längre har täckning för.
   */
  it("räknar om gruppen när en medlem raderas", async () => {
    const forsta = await lagg("colorama-90-a");
    const kapat = await lagg("colorama-90-b");
    const tredje = await lagg("colorama-90-c");

    // `bara`: en enskild fångst, utan att ta kvittot med sig. Den vanliga vägen tar
    // hela köpet — tre foton av samma papper är ett kvitto — och det prövas nedan.
    await archive.taBort(forsta, true);
    expect(gruppFor(archive.db, kapat)!.medlemmar.map((m) => m.id).sort()).toEqual([kapat, tredje].sort());
    expect((gruppFor(archive.db, kapat)!.falt.store as { value: string }).value).toBe("Colorama");

    await archive.taBort(tredje, true);
    const ensamt = gruppFor(archive.db, kapat)!;
    expect(ensamt.grupp).toBeNull();
    expect(ensamt.medlemmar).toEqual([]);
    expect(ensamt.falt.store).toBeUndefined();
    expect(ofardiga(archive.db).map((r) => r.id)).toEqual([kapat]);
  });

  /**
   * Raderingen tar kvittot, inte fotografiet.
   *
   * Det var det som gjorde att beställarens fem sista rader inte försvann: han tog
   * bort den fångst raden visade, nästa tog dess plats, och raden stod kvar fast
   * svaret sa att raderingen lyckats — tre gånger för ett kvitto.
   */
  it("tar hela kvittot, hur många gånger papperet än fotograferats", async () => {
    const forsta = await lagg("colorama-90-a");
    await lagg("colorama-90-b");
    await lagg("colorama-90-c");
    expect(arkiv(archive.db, {}).total).toBe(1);

    const { antal } = await archive.taBort(forsta);

    expect(antal).toBe(3);
    expect(arkiv(archive.db, {}).total).toBe(0);
    expect(ofardiga(archive.db)).toEqual([]);
  });

  /**
   * Telefonens hemskärm är inte arkivet. Den svarar på "kom bilden fram?", och då ska
   * varje fångst synas — även den andra bilden av ett papper man redan fotograferat.
   * Ett kvitto som tyst försvann ur listan hade sett ut som en förlorad bild.
   */
  it("visar varje fångst för sig på telefonen, men ett köp per rad i arkivet", async () => {
    await lagg("colorama-90-a");
    await lagg("colorama-90-b");
    await lagg("colorama-90-c");

    const telefonen = arkiv(archive.db, { ofardiga: true });
    expect(telefonen.total).toBe(3);
    expect(telefonen.receipts).toHaveLength(3);
    expect(telefonen.receipts.every((r) => r.segments === 1)).toBe(true);
    expect(arkiv(archive.db, {}).receipts).toHaveLength(1);
  });

  /**
   * Sökningen får inte tappa en träff för att den stod i det syskonfoto som inte
   * företräder köpet. `Beställningsvaror` står bara i det kapade fotot — det är just
   * den bild vars egen läsning saknar butiksnamn, alltså den som annars aldrig hade
   * blivit gruppens ansikte utåt.
   */
  it("hittar köpet på ett ord som bara ett av fotografierna läste", async () => {
    await lagg("colorama-90-a");
    await lagg("colorama-90-b");
    await lagg("colorama-90-c");

    const traffar = arkiv(archive.db, { q: ftsQuery("beställningsvaror") });
    expect(traffar.receipts).toHaveLength(1);
    expect(traffar.receipts[0]!.store).toBe("Colorama");
    expect(traffar.receipts[0]!.snippet).toMatch(/beställningsvaror/i);
  });

  /**
   * Vägen ut ur en felaktig sammanslagning.
   *
   * Det är grupperingens enda fel som inte kostar en rad utan **tar bort en**: ett köp
   * som göms bakom ett annat syns aldrig av sig självt. Nejet måste därför både verka
   * direkt och överleva att indexet byggs om — ett beslut som bara låg i indexet hade
   * upphävts av nästa schemaändring, och kvittona hade krupit ihop igen.
   */
  it("skiljer ett kvitto ur gruppen, och håller det skilt genom en ombyggnad", async () => {
    const forsta = await lagg("colorama-90-a");
    const kapat = await lagg("colorama-90-b");
    const tredje = await lagg("colorama-90-c");
    expect(gruppFor(archive.db, forsta)!.medlemmar).toHaveLength(3);

    await archive.skiljAt(forsta);

    // Det skilda står ensamt, med bara sin egen läsning kvar.
    expect(gruppFor(archive.db, forsta)!.grupp).toBeNull();
    // De andra två delar kortreferens och hör ihop som förut.
    expect(gruppFor(archive.db, kapat)!.medlemmar.map((m) => m.id).sort()).toEqual([kapat, tredje].sort());

    // Beslutet ligger i sidecaren, inte i indexet.
    expect((await archive.get(forsta))!.inteSamma).toEqual(expect.arrayContaining([kapat, tredje]));

    archive.close();
    await rm(join(dir, "index.sqlite"), { force: true });
    archive = Archive.open(dir);
    await archive.reindex();

    expect(gruppFor(archive.db, forsta)!.grupp).toBeNull();
    expect(gruppFor(archive.db, kapat)!.medlemmar).toHaveLength(2);
  });

  /**
   * Kedjan. Gruppen är ett transitivt hölje, och beställarens tre Colorama-foton
   * hänger ihop genom mittenbilden: den delar kortreferens med det tredje och
   * klockslag med det första, medan första och tredje bara delar dag, belopp och
   * bolag — vilket är "svagt" och aldrig binder.
   *
   * Skiljer man därför ut just mittenbilden faller de andra två också isär. Det är
   * rätt svar och inte en lucka: beviset gick genom det foto en människa nyss sagt
   * inte hör hit. Priset är en extra rad i arkivet, aldrig ett dolt köp.
   */
  it("låter de andra falla isär när beviset gick genom det man skilde ut", async () => {
    const forsta = await lagg("colorama-90-a");
    const kapat = await lagg("colorama-90-b");
    const tredje = await lagg("colorama-90-c");

    await archive.skiljAt(kapat);

    expect(gruppFor(archive.db, forsta)!.grupp).toBeNull();
    expect(gruppFor(archive.db, tredje)!.grupp).toBeNull();
    // Två rader i arkivet, och det kapade fotot tillbaka i aktiviteten: utan gruppen
    // har det ingen butik igen, och det är sant — den står inte i den bilden.
    expect(arkiv(archive.db, {}).total).toBe(2);
    expect(ofardiga(archive.db).map((r) => r.id)).toEqual([kapat]);
  });

  /** Ett nej går att ta tillbaka: paret prövas då på nytt som vilket annat som helst. */
  it("slår ihop igen när nejet tas tillbaka", async () => {
    await lagg("colorama-90-a");
    const kapat = await lagg("colorama-90-b");
    await lagg("colorama-90-c");

    await archive.skiljAt(kapat);
    expect(gruppFor(archive.db, kapat)!.grupp).toBeNull();

    await archive.aterforena(kapat);
    expect(gruppFor(archive.db, kapat)!.medlemmar).toHaveLength(3);
    expect((gruppFor(archive.db, kapat)!.falt.store as { value: string }).value).toBe('Colorama');
  });

  /**
   * Grupperna är härledda som allt annat i indexet: kastas filen ska en ombyggnad ur
   * `receipts/` ge exakt samma grupper. Namnet på gruppen räknas därför ur medlemmarna
   * — minsta id:t — i stället för att myntas när gruppen uppstår.
   */
  it("bygger samma grupper ur disken som växte fram inkrementellt", async () => {
    const ids = [await lagg("colorama-90-a"), await lagg("colorama-90-b"), await lagg("colorama-90-c")];
    await lagg("byggmax-219");
    const fore = ids.map((id) => gruppFor(archive.db, id)!.grupp);
    archive.close();

    await rm(join(dir, "index.sqlite"), { force: true });
    archive = Archive.open(dir);
    await archive.reindex();

    expect(ids.map((id) => gruppFor(archive.db, id)!.grupp)).toEqual(fore);
    expect(arkiv(archive.db, {}).total).toBe(2);
  });
});
