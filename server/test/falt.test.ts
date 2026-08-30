import { describe, expect, it } from "vitest";
import { utvinn, utvinnUtanAttSkrivaOver } from "../src/falt/index.js";
import { utvinnDatum, giltigt } from "../src/falt/datum.js";
import { utvinnBelopp } from "../src/falt/belopp.js";
import { utvinnButik } from "../src/falt/butik.js";
import { envariationer, siffervik } from "../src/falt/tecken.js";

/**
 * Texterna är inte påhittade. De är klippta ur M5a-mätningen på beställarens egna
 * kvitton, med felen kvar — det är just felen reglerna finns för.
 */
const HORNBACH_BRA =
  "HORNBACH Det finns alltid nät att güra. 41 Gtsborg Tel 03 830\n" +
  "ART/EAN 7350062892345 1 Styck × 61,95 KORT-FODERLIST 12X69 61,95 1\n" +
  "Summa[22] SEK 1426,45 GIVET Mastercard SEK 1426,45\n" +
  "Hornbach Gõeborg Minelundsväen 8 GOEBORG Tel.Nr: 0317799300 0rg.Nr: 5566134853 2026-05-31 15:03\n" +
  "BRUTTO MOMS NETTO 125 % 1426,45 285,29 1141,16";

const HORNBACH_TRASIG =
  "HORNBACHV ART/EAN_7350062892345 86,00 172,001\n" +
  "Sunna【22】 SEK 1426,45 GIVET Mastercard SEK 1426,45\n" +
  "0317799300 0r9.Nr: 5566134853 2026-06-31 16:02\n" +
  "125 X 1426,45 285,29 1141,16";

const BYGGMAX =
  "Byggmax Hissingsbacka s 1 Transportgatan 45 KASSAKVITTO\n" +
  "1s0 × 21900kr 219.00 Tot.all 175.20 kr Munis 43.80 kr 257% 43,80kr\n" +
  "Totalt ( nkl. morns) 219,00 kr Kassa Kass3 4 Kvittonummer CO1204-00170393\n" +
  "Daturn. 2026-05-25 16.46 Nets. 219.00 kr";

const FANGAT = "2026-06-02T10:00:00.000Z";

describe("teckenhopvikning", () => {
  it("viker bokstäver till siffror i tal", () => {
    expect(siffervik("0r9.Nr")).toBe("0r9.Nr".replace("r", "r"));
    expect(siffervik("1s0")).toBe("150");
    expect(siffervik("2O26-O5-31")).toBe("2026-05-31");
  });

  it("ger varianter där en siffra bytts mot en förväxling", () => {
    expect(envariationer("06")).toContain("05");
    expect(envariationer("06")).not.toContain("06");
  });
});

describe("datum", () => {
  it("vet vilka datum som finns", () => {
    expect(giltigt(2026, 5, 31)).toBe(true);
    expect(giltigt(2026, 6, 31)).toBe(false);
    expect(giltigt(2026, 2, 30)).toBe(false);
    expect(giltigt(2024, 2, 29)).toBe(true);
  });

  it("läser datumet ur ett kvitto som lästes rätt", () => {
    const [basta] = utvinnDatum(HORNBACH_BRA, FANGAT);
    expect(basta!.value).toBe("2026-05-31");
    expect(basta!.lagad).toBe(false);
  });

  it("lagar den 31 juni till den 31 maj med en siffras byte", () => {
    const [basta] = utvinnDatum(HORNBACH_TRASIG, FANGAT);
    // Den 31 juni finns inte. Kalendern förkastar, och en förväxling 6→5 lagar.
    expect(basta!.value).toBe("2026-05-31");
    expect(basta!.lagad).toBe(true);
    // Och det ska synas att det är en lagning, inte en avläsning.
    expect(basta!.confidence).toBeLessThan(0.6);
  });

  it("läser datum där tiden sitter ihop med det", () => {
    const [basta] = utvinnDatum("Daturn 2026-05-2516 46", FANGAT);
    expect(basta!.value).toBe("2026-05-25");
  });

  it("låter samstämmighet väga tyngre än en enstaka läsning", () => {
    const text = "2026-05-31 15:03\n2026-05-31 15:03\n2026-05-31\n2026-04-02";
    const [basta, tvaa] = utvinnDatum(text, FANGAT);
    expect(basta!.value).toBe("2026-05-31");
    expect(basta!.forekomster).toBe(3);
    expect(basta!.confidence).toBeGreaterThan(tvaa!.confidence);
  });

  it("tar inte organisationsnummer för datum", () => {
    const kandidater = utvinnDatum("0rg.Nr: 5566134853 2026-05-31", FANGAT);
    expect(kandidater.map((k) => k.value)).toContain("2026-05-31");
    // 5566-13-48 är inget rimligt inköpsdatum och ska inte ens vara kandidat.
    expect(kandidater.map((k) => k.value)).not.toContain("5566-13-48");
  });

  it("tar inte ett datum efter att kvittot fotograferades", () => {
    expect(utvinnDatum("2030-01-01", FANGAT).map((k) => k.value)).not.toContain("2030-01-01");
  });
});

describe("belopp", () => {
  it("hittar totalen och kontrollerar den mot momsraden", () => {
    const [basta] = utvinnBelopp(HORNBACH_BRA);
    expect(basta!.value).toBe(1426.45);
    expect(basta!.momskontrollerad).toBe(true);
    expect(basta!.forekomster).toBeGreaterThanOrEqual(3);
  });

  it("väljer totalen framför raderna ovanför", () => {
    const [basta] = utvinnBelopp(BYGGMAX);
    expect(basta!.value).toBe(219);
  });

  it("tar inte styckpriser för totalen", () => {
    const kandidater = utvinnBelopp(HORNBACH_BRA);
    expect(kandidater[0]!.value).not.toBe(61.95);
  });
});

describe("butik", () => {
  it("känner igen kedjan även när logotypen lästes fel", () => {
    // M5a gav HORNBAGH, RORNBAGH och DHORN BACH för samma butik.
    for (const text of ["HORNBAGH Det fins altid", "RORNBAGH V Bet fians altid", HORNBACH_BRA]) {
      expect(utvinnButik(text)[0]!.value).toBe("Hornbach");
    }
  });

  it("känner igen Byggmax trots stavfelen runt omkring", () => {
    expect(utvinnButik(BYGGMAX)[0]!.value).toBe("Byggmax");
  });

  it("gissar på första raden när ingen kedja känns igen, med låg konfidens", () => {
    const [basta] = utvinnButik("Lilla Kvarnbageriet\nBröd 45,00\nSumma 45,00");
    expect(basta!.kand).toBe(false);
    expect(basta!.confidence).toBeLessThan(0.4);
  });
});

describe("utvinn", () => {
  it("ger alla tre fälten ur ett riktigt kvitto", () => {
    const falten = utvinn(HORNBACH_BRA, FANGAT);
    expect(falten.store?.value).toBe("Hornbach");
    expect(falten.date?.value).toBe("2026-05-31");
    expect(falten.total?.value).toBe(1426.45);
    expect(falten.currency?.value).toBe("SEK");
    expect(falten.total?.source).toBe("ocr");
  });

  it("ger ingenting alls för tom text i stället för att gissa", () => {
    expect(utvinn("", FANGAT)).toEqual({});
    expect(utvinn("   \n  ", FANGAT)).toEqual({});
  });

  it("sparar alternativen så att en människa kan välja i stället för att skriva", () => {
    const falten = utvinn("2026-05-31\n2026-04-02\n2026-03-11\nSumma 100,00", FANGAT);
    expect(falten.date?.candidates?.length).toBeGreaterThan(0);
  });

  it("skriver aldrig över det en människa bestämt", () => {
    const rattat = {
      store: { value: "Hornbach Göteborg", confidence: 1, source: "manual" as const },
      date: { value: "2026-05-30", confidence: 0.6, source: "ocr" as const },
    };
    const ut = utvinnUtanAttSkrivaOver(HORNBACH_BRA, FANGAT, rattat);
    // Rättelsen står kvar …
    expect(ut.store?.value).toBe("Hornbach Göteborg");
    expect(ut.store?.source).toBe("manual");
    // … men det maskinlästa räknas om.
    expect(ut.date?.value).toBe("2026-05-31");
  });
});

describe("rättning i arkivet", () => {
  it("skriver en post i corrections även när maskinen hade rätt", async () => {
    const { Archive } = await import("../src/store/archive.js");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "kvitto-falt-"));
    const archive = Archive.open(dir);
    try {
      const id = "01M18WABG9Y3KZAED79J45DHPK";
      await archive.create({ id });
      await archive.saveOcr(id, HORNBACH_BRA, null);

      const efterOcr = await archive.get(id);
      expect((efterOcr!.fields as Record<string, { value: unknown }>)["store"]!.value).toBe("Hornbach");

      // Bekräftad utan ändring: värdet står kvar, men källan och posten ändras.
      const bekraftad = await archive.rattaFalt(id, "store", "Hornbach", true);
      const falt = (bekraftad.fields as Record<string, { source: string; confidence: number }>)["store"]!;
      expect(falt.source).toBe("confirmed");
      expect(falt.confidence).toBe(1);
      expect(bekraftad.corrections).toHaveLength(1);
      expect(bekraftad.corrections[0]).toMatchObject({ field: "store", action: "confirmed", to: "Hornbach" });

      // Och en omtolkning får inte röra det en människa bestämt.
      await archive.reextract();
      const efter = await archive.get(id);
      expect((efter!.fields as Record<string, { source: string }>)["store"]!.source).toBe("confirmed");
    } finally {
      archive.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("fällor ur verklig text", () => {
  const MOMSRAD =
    "HORNBACH Det finns alltid nät att güra\n" +
    "Summa[22] SEK 1426,45\n" +
    "Hornbach Gõeborg 2026-05-31 15:03\n" +
    "BRUTTO MOMS NETTO 125 % 1426,45 285,29 1141,16";

  it("tar inte NETTO i momsraden för butiken Netto", () => {
    // Ordet står på varje svenskt kvitto och gjorde Hornbach till en Netto-butik.
    expect(utvinnButik(MOMSRAD).map((k) => k.value)).not.toContain("Netto");
    expect(utvinnButik(MOMSRAD)[0]!.value).toBe("Hornbach");
  });

  it("väljer inte ett datum som ligger efter att kvittot fotograferades", () => {
    // 2026-06-31 finns inte och går att laga både till maj och till augusti. Fotot är
    // taget den 30 augusti, så augustivarianten ligger i framtiden och kan inte vara
    // ett inköpsdatum — även om den ligger närmare i tid.
    const kandidater = utvinnDatum("0r9.Nr: 5566134853 2026-06-31 16:02", "2026-08-30T10:00:00.000Z");
    expect(kandidater[0]!.value).toBe("2026-05-31");
  });
});
