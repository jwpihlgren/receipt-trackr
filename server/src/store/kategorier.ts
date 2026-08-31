/**
 * Kategorierna, och regeln som kopplar en butik till en av dem.
 *
 * **Kategorin är inte läst ur kvittot.** Ingenting på ett papper från Colorama säger
 * "bygg och färg" — det är en indelning som finns i huvudet på den som handlar. Därför
 * kommer den inte ur utvinningen utan ur en regel per butik: butiken föreslår, en
 * människa rättar, och rättelsen ändrar vad butiken betyder för alla kvitton därifrån.
 * Det var beställarens eget val i intervjun, och det är det som gör trettio kvitton
 * kategoriserade utan att någon betar av en lista.
 *
 * Filen är **sanning**, som sidecarerna: den ligger i arkivet, går att läsa och rätta
 * i en texteditor om tio år, och skrivs atomiskt. Indexets `kategori`-kolumn är
 * härledd ur den och kan alltid byggas om.
 */
import { closeSync, openSync, fsyncSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KEDJOR } from "../falt/butik.js";

export const KATEGORIER_FILE = "kategorier.json";
export const SCHEMA = "receipt-trackr/kategorier@1";

/** Kategorin för det som ingen regel täcker. Den är frånvaron av en kategori, inte en. */
export const OVRIGT = "Övrigt";

export type Kategorier = {
  schema: typeof SCHEMA;
  /**
   * Ordningen är färgens. Gränssnittet delar ut färger efter den här listan och
   * aldrig efter storlek — en kategori som växer ska inte byta färg, och ett filter
   * som tar bort en får inte måla om de andra.
   */
  kategorier: string[];
  /** Butik → kategori. Nyckeln är butiksnamnet som det står i arkivet. */
  regler: Record<string, string>;
};

const BYGG = "Bygg och färg";
const BIL = "Bil";
const HEM = "Hem och trädgård";
const MAT = "Mat och dryck";
const KLADER = "Kläder";

/**
 * Utgångsläget: de kedjor appen redan känner igen, indelade en gång.
 *
 * Listan är samma `KEDJOR` som fältutvinningen matchar mot — ingen påhittad butik är
 * tillagd här. Allt annat hamnar i `Övrigt` tills någon säger vad det är, och det är
 * ärligare än en gissning som ser ut som ett svar.
 */
const UTGANGSREGLER: Record<string, string> = {
  ICA: MAT, Coop: MAT, Willys: MAT, Hemköp: MAT, Lidl: MAT, Netto: MAT,
  "City Gross": MAT, Matöppet: MAT, Systembolaget: MAT, Pressbyrån: MAT,
  "7-Eleven": MAT, "Espresso House": MAT, "Waynes Coffee": MAT,

  Byggmax: BYGG, Hornbach: BYGG, Bauhaus: BYGG, "K-Rauta": BYGG, Beijer: BYGG,
  Jula: BYGG, "Clas Ohlson": BYGG, Flügger: BYGG, Colorama: BYGG,
  Fresks: BYGG, Optimera: BYGG,

  Biltema: BIL, Däckskiftarna: BIL, "Circle K": BIL, OKQ8: BIL, Ingo: BIL, Preem: BIL,
  Shell: BIL, St1: BIL, Tesla: BIL,

  IKEA: HEM, Rusta: HEM, Dollarstore: HEM, Åhléns: HEM, "Søstrene Grene": HEM,
  Granngården: HEM, Plantagen: HEM, Blomsterlandet: HEM,

  "H&M": KLADER, Lindex: KLADER, KappAhl: KLADER, Dressmann: KLADER, Eurosko: KLADER,
  Stadium: KLADER, XXL: KLADER, Intersport: KLADER,
};

export function standard(): Kategorier {
  return {
    schema: SCHEMA,
    kategorier: [BYGG, BIL, HEM, MAT, KLADER, OVRIGT],
    regler: { ...UTGANGSREGLER },
  };
}

/**
 * Läser filen, och skapar den ur utgångsläget första gången.
 *
 * Synkront med flit: den läses en gång när arkivet öppnas, och att göra `Archive.open`
 * asynkron för en fil på några kilobyte vore att betala med hela anropskedjan.
 */
export function lasKategorier(dataDir: string): Kategorier {
  const path = join(dataDir, KATEGORIER_FILE);
  try {
    const läst = JSON.parse(readFileSync(path, "utf8")) as Partial<Kategorier>;
    // En fil som någon redigerat för hand kan vara halv. Det som saknas fylls ur
    // utgångsläget i stället för att kasta: en trasig kategorifil ska inte stoppa
    // arkivet, för kategorin är härledd och kvittona är sanningen.
    return {
      schema: SCHEMA,
      kategorier: Array.isArray(läst.kategorier) && läst.kategorier.length ? läst.kategorier : standard().kategorier,
      regler: läst.regler && typeof läst.regler === "object" ? läst.regler : standard().regler,
    };
  } catch {
    const ny = standard();
    try {
      skrivKategorier(dataDir, ny);
    } catch {
      // Går arkivet inte att skriva i just nu är utgångsläget ändå rätt svar.
    }
    return ny;
  }
}

/** tmp → fsync → rename, samma ordning som sidecarerna. Aldrig en halv fil. */
export function skrivKategorier(dataDir: string, kategorier: Kategorier): void {
  const target = join(dataDir, KATEGORIER_FILE);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, `${JSON.stringify(kategorier, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Kategorin för en butik.
 *
 * Tre steg, i fallande säkerhet: namnet som det står, namnet oavsett versaler, och
 * sist en känd kedja *inuti* namnet — "Bauhaus Kungens Kurva" är Bauhaus. Det sista
 * steget kräver en ordgräns, annars hade "Preem" hittats i "Premium".
 */
export function kategoriFor(kategorier: Kategorier, butik: string | null | undefined): string {
  // Kategorin är härledd och kosmetisk; kvittot är sanningen. En trasig eller
  // saknad regeluppsättning ska därför aldrig kunna hindra en skrivning i arkivet.
  if (!kategorier?.regler) return OVRIGT;
  if (!butik?.trim()) return OVRIGT;
  const namn = butik.trim();
  const direkt = kategorier.regler[namn];
  if (direkt) return direkt;

  const vikt = namn.toLocaleLowerCase("sv");
  for (const [nyckel, kategori] of Object.entries(kategorier.regler)) {
    if (nyckel.toLocaleLowerCase("sv") === vikt) return kategori;
  }
  for (const [nyckel, kategori] of Object.entries(kategorier.regler)) {
    const kedja = nyckel.toLocaleLowerCase("sv");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${kedja.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u").test(vikt)) {
      return kategori;
    }
  }
  return OVRIGT;
}
