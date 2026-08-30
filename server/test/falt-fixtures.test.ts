/**
 * Guldtest mot beställarens egna kvitton.
 *
 * Texterna i `fixtures/kvitton.json` kommer ur en riktig körning på mätsidan
 * 2026-08-30: 35 kvitton fotograferade med telefon, tolkade i webbläsaren, och sedan
 * inklistrade i samtalet. Det är första gången utvinningen mäts mot något annat än
 * mina egna påhittade rader — och den föll på flera av dem.
 *
 * Testet är därför tudelat: en **poängsättning** som skriver ut hur många fält som
 * blev rätt, och några **spärrar** för de enskilda felen. Poängen får aldrig sjunka;
 * spärrarna får aldrig gå sönder.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { utvinn } from "../src/falt/index.js";

type Kvitto = {
  fil: string;
  butik: string | null;
  datum: string | null;
  belopp: number | null;
  grupp?: string;
  anm?: string;
  text: string;
};

const { kvitton } = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/kvitton.json"), "utf8"),
) as { kvitton: Kvitto[] };

/** Fotografierna togs 2026-08-28; det är det datum utvinningen får veta. */
const FOTAT = "2026-08-28T12:45:00.000Z";

function las(kvitto: Kvitto) {
  const f = utvinn(kvitto.text, FOTAT);
  return {
    butik: (f.store?.value as string | undefined) ?? null,
    datum: (f.date?.value as string | undefined) ?? null,
    belopp: (f.total?.value as number | undefined) ?? null,
  };
}

describe("fältutvinningen mot riktiga kvitton", () => {
  it("läser fälten minst lika bra som senaste mätningen", () => {
    const poang = { butik: 0, datum: 0, belopp: 0 };
    const vantat = { butik: 0, datum: 0, belopp: 0 };
    const missar: string[] = [];

    for (const kvitto of kvitton) {
      const fick = las(kvitto);
      for (const namn of ["butik", "datum", "belopp"] as const) {
        if (kvitto[namn] === null) continue;
        vantat[namn]++;
        if (fick[namn] === kvitto[namn]) poang[namn]++;
        else missar.push(`${kvitto.fil} ${namn}: ${JSON.stringify(fick[namn])} ≠ ${JSON.stringify(kvitto[namn])}`);
      }
    }

    // Skrivs ut vid fel, så att en sänkning syns med namn och inte bara som en siffra.
    const sammanfattning =
      `butik ${poang.butik}/${vantat.butik} · datum ${poang.datum}/${vantat.datum} · ` +
      `belopp ${poang.belopp}/${vantat.belopp}\n` + missar.join("\n");

    expect(poang.butik, sammanfattning).toBeGreaterThanOrEqual(GOLV.butik);
    expect(poang.datum, sammanfattning).toBeGreaterThanOrEqual(GOLV.datum);
    expect(poang.belopp, sammanfattning).toBeGreaterThanOrEqual(GOLV.belopp);
  });

  /**
   * Kedjelistan får aldrig hitta en butik som inte står på kvittot. Ett tomt fält är
   * ärligt; "Tesla" på ett kvitto från Blomsterlandet är en lögn som dessutom
   * förgiftar varje matchning som använder butiken som nyckel.
   */
  it.each([
    ["blomsterlandet-tesla", "Tesla"],
    ["flugger-preem", "Preem"],
    ["sostrene-hm-a", "H&M"],
    ["sostrene-hm-b", "H&M"],
  ])("hittar ingen påhittad kedja i %s", (fil, fel) => {
    const kvitto = kvitton.find((k) => k.fil === fil)!;
    expect(las(kvitto).butik).not.toBe(fel);
  });

  /**
   * Hittar utvinningen ingen butik ska fältet vara **tomt**, inte fyllt med det första
   * som stod på kvittot. Alla tre kom ur beställarens andra körning: en slogan, ett
   * ord ur en logotyp, och kedjan `Netto` funnen i `NETT01 T0T` på en momsrad.
   */
  it.each([["slogan-forst"], ["sostrene-utan-logotyp"]])("lämnar butiken tom i %s", (fil) => {
    const kvitto = kvitton.find((k) => k.fil === fil)!;
    expect(las(kvitto).butik).toBeNull();
  });

  it("tar inte momsradens NETTO för kedjan Netto", () => {
    expect(las(kvitton.find((k) => k.fil === "lighthouse-netto")!).butik).toBe("LIGHTHOUSE");
  });

  /** Butiken är ett namn, inte kvittots sextio första tecken. */
  it("gör aldrig en adressrad eller momsrad till butiksnamn", () => {
    for (const kvitto of kvitton) {
      const butik = las(kvitto).butik;
      if (butik === null) continue;
      expect(butik.length, `${kvitto.fil}: ${butik}`).toBeLessThanOrEqual(30);
      expect(butik, kvitto.fil).not.toMatch(/\b(MOMS|NETTO|BRUTTO|TOTALT|KUNDENS|EXEMPLAR|Tel\.)\b/i);
    }
  });

  /** En rad om ångerrätt är inte ett inköpsdatum. */
  it("tar inte 'öppet köp t.o.m' som kvittots datum", () => {
    const kvitto = kvitton.find((k) => k.fil === "blomsterlandet-tesla")!;
    expect(las(kvitto).datum).not.toBe("2026-05-26");
  });

  it("kraschar inte på en bild utan text", () => {
    expect(() => las(kvitton.find((k) => k.fil === "tom-bild")!)).not.toThrow();
  });
});

/**
 * Golvet, uppmätt 2026-08-30 efter omskrivningen av utvinningen. Före den satt siffrorna
 * på 5 / 16 / 20 — butiken var alltså fel på arton kvitton av tjugotre.
 *
 * Höjs när utvinningen blir bättre, aldrig sänkt för att få ett test grönt: en sänkning
 * här är ett beslut att arkivet får bli sämre.
 */
const GOLV = { butik: 23, datum: 24, belopp: 27 };

/**
 * De två butiker som fattas är `null`, inte fel — kvittot vars huvud är bortklippt har
 * inget namn att ge. Båda har ett annat foto av samma kvitto som läser namnet rätt, och
 * det är den luckan gruppröstningen ska fylla.
 */
