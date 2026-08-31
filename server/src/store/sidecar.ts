/**
 * `receipt.json` är sanningen om ett kvitto. Indexet är härlett och kan alltid byggas
 * om; sidecaren kan det inte. Därför gäller en enda regel för skrivordning, och den
 * finns här: **sidecar först, atomiskt, därefter indexet. Aldrig tvärtom.** Kraschar
 * det däremellan är disken korrekt och indexet efterblivet, vilket `reindex` löser.
 */
import { open, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { sidecarPath } from "./paths.js";
import type { Identitet } from "../falt/identitet.js";

export const SCHEMA = "receipt-trackr/receipt@1";

export type Rotation = 0 | 90 | 180 | 270;

export type Segment = {
  file: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  /** Mätvärden från kameran vid fångst; frivilliga, och klienten äger dem. */
  capture?: Record<string, unknown>;
  /**
   * Hur bilden ska vridas för att stå rätt, satt av en människa som tittat på den.
   *
   * Filen själv rörs aldrig — dess bytes är arkivets sanning och deras sha256 är
   * kvittensen på att rätt bild kom fram. Vridningen är ett påstående *om* bilden,
   * och den gäller överallt: skärmen visar den vriden, tumnageln byggs om, och
   * tolkningsjobbet bär den så att en omläsning läser papperet åt rätt håll i stället
   * för att gissa. Saknas fältet är det noll, vilket inte är samma sak som att någon
   * sagt att bilden står rätt.
   */
  rotation?: Rotation;
};

/** `correct` = fälten stämde. `wrong` = minst ett var fel och rättades. `unreadable` = går inte att avgöra ur bilden. */
export type Verdict = "correct" | "wrong" | "unreadable";

export type Review = {
  sampled: boolean;
  reviewedAt?: string;
  verdict?: Verdict;
  /** Tid från att kvittot visades till att utfallet gavs. */
  dwellMs?: number;
  /** Om bilden hunnit laddas när utfallet gavs. Ett nej gör granskningen värdelös. */
  sawImage?: boolean;
};

export type Receipt = {
  schema: typeof SCHEMA;
  id: string;
  capturedAt: string;
  /** Gamla högen eller färskt kvitto — styr mätningen, se planens mätavsnitt. */
  backlog: boolean;
  segments: Segment[];
  /**
   * Hur många segment klienten säger att kvittot har, satt när användaren tryckt
   * "Klart". Utan den siffran går ett tappat andra segment inte att skilja från ett
   * kvitto som bara hade ett — och det är precis den tysta förlusten arkivet finns
   * för att förhindra. `null` betyder att fångsten fortfarande pågår.
   */
  expectedSegments: number | null;
  completedAt: string | null;
  fields: Record<string, unknown>;
  corrections: unknown[];
  /**
   * Kalibreringsurvalet. `sampled` sätts när kvittot **dragits** — slumpmässigt och
   * oberoende av konfidens — och resten fylls när någon faktiskt granskat det mot
   * bilden. Skillnaden bär hela mätningen: ett kvitto man råkat titta på säger bara
   * något om vad man snubblade på, medan ett draget kvitto säger något om högen.
   *
   * `dwellMs` och `sawImage` finns för att en granskning som gick för fort, eller som
   * gjordes utan att bilden hann visas, ska gå att räkna bort i efterhand i stället
   * för att tyst förbättra siffran.
   */
  review: Review;
  /**
   * En bild som utlovades men aldrig kom fram, och som en människa sagt är borta.
   *
   * Förlusten skrivs ned i stället för att bara försvinna ur listan. `expectedSegments`
   * sänks till det som faktiskt finns, så kvittot räknas som helt — men vad som gick
   * förlorat, och när någon konstaterade det, står kvar för alltid. Bilderna är
   * oåterkalleliga; att de var det ska inte gå att glömma bort.
   */
  lostSegments?: { at: string; utlovade: number; faktiska: number };
  /**
   * Bilder en människa kasserat: en suddig, en avklippt, en som kom med tummen på.
   *
   * Regeln om oåterkalleliga bilder skyddar mot **tyst** förlust — en krasch, ett
   * tappat svar, en kapplöpning — inte mot någon som tittat på fotot och sagt att det
   * inte duger. Men förlusten skrivs ned: vad som fanns, när det försvann, och om
   * något kom i stället. `sha256` är den kasserade bildens, och den är det enda som
   * blir kvar av den.
   */
  kasserade?: { at: string; index: number; sha256: string; orsak: "ersatt" | "borttagen" }[];
  ocr: unknown | null;
  tags: { user: string[]; auto: string[] };
  /** Hela råtexten, radbruten. Fylls av OCR-steget i M5. */
  text: string;
  /**
   * Kvittots egna nummer: organisationsnummer, kvittonummer, klockslag,
   * kortterminalens referens. Härlett ur `text`, precis som `fields`, och skrivet i
   * samma stund.
   *
   * Det är identiteten som avgör vilka kvitton som visar **samma köp**. Grupperna
   * själva står däremot aldrig här: en grupp är ett påstående om två kvitton, och
   * ändras det ena kan det andras sidecar inte skrivas om i samma andetag. Grupper
   * härleds därför i indexet, där de får kastas och räknas om.
   */
  identity?: Identitet;
};

export function newReceipt(id: string, capturedAt: string, backlog: boolean): Receipt {
  return {
    schema: SCHEMA,
    id,
    capturedAt,
    backlog,
    segments: [],
    expectedSegments: null,
    completedAt: null,
    fields: {},
    corrections: [],
    review: { sampled: false },
    ocr: null,
    tags: { user: [], auto: [] },
    text: "",
  };
}

export async function readSidecar(dataDir: string, id: string): Promise<Receipt | null> {
  try {
    return JSON.parse(await readFile(sidecarPath(dataDir, id), "utf8")) as Receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * tmp → fsync → rename. `fsync` är det som gör skillnad vid strömavbrott: utan den
 * kan `rename` bli synlig medan innehållet ännu inte nått disken, och då står det en
 * tom eller halv fil där sanningen om ett kvitto ska ligga.
 */
export async function writeSidecar(dataDir: string, receipt: Receipt): Promise<string> {
  const target = sidecarPath(dataDir, receipt.id);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
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
  // Även katalogposten behöver nå disken för att bytet ska överleva ett strömavbrott.
  const dir = await open(dirname(target), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
  return target;
}
