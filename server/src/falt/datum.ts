/**
 * Inköpsdatum ur råtexten.
 *
 * Läxan från M0 var att datum var svagast av fälten, 74 %. M5a visade varför, och det
 * var inte att OCR:en är dålig på datum: samma köp lästes `2026-05-31 15:03` på tre
 * segment och `2026-06-31 16:02` på ett fjärde. Den 31 juni finns inte.
 *
 * Alltså tre steg, i den ordningen:
 *
 *   1. **Kalendern förkastar.** Ett omöjligt datum är inte ett osäkert datum, det är
 *      ett felläst datum, och det ska inte konkurrera med de riktiga.
 *   2. **En siffra får lagas.** Går det omöjliga datumet att göra giltigt genom att
 *      byta en enda siffra mot en känd förväxling, är det en kandidat — men med lägre
 *      konfidens än ett som lästes rätt direkt.
 *   3. **Samstämmighet vinner.** Ett kvitto innehåller nästan alltid sitt datum flera
 *      gånger. Tre segment som säger samma sak väger tyngre än ett som säger annat,
 *      och det är den enda signal som inte kommer ur en gissning om teckenformer.
 */
import { envariationer, siffervik } from "./tecken.js";

export type Kandidat = { value: string; confidence: number; forekomster: number; lagad: boolean };

/**
 * Datum och tid springer ihop i kvittotext: `2026-05-2516 46`, `2026-05-3115020026`.
 * Skannern tar därför åtta siffror i följd och bryr sig inte om vad som kommer sedan.
 * Avgränsarna får saknas, och bokstäver som läses som siffror viks först.
 */
const SKANNER = /(\d{4})[-./ ]?(\d{2})[-./ ]?(\d{2})/g;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Sant bara för datum som finns. Februari 30 och juni 31 faller här. */
export function giltigt(ar: number, manad: number, dag: number): boolean {
  if (manad < 1 || manad > 12 || dag < 1 || dag > 31) return false;
  const d = new Date(Date.UTC(ar, manad - 1, dag));
  return d.getUTCFullYear() === ar && d.getUTCMonth() === manad - 1 && d.getUTCDate() === dag;
}

/**
 * @param capturedAt när kvittot fotograferades. Ett kvitto fotograferas efter köpet,
 *   aldrig före, och sällan mer än något år efteråt — det utesluter årtal ur
 *   organisationsnummer och kortnummer utan att någon regel behöver nämna dem.
 */
export function utvinnDatum(text: string, capturedAt: string): Kandidat[] {
  const fangat = new Date(capturedAt);
  const rakning = new Map<string, { forekomster: number; lagad: boolean }>();

  for (const rad of text.split(/\n+/)) {
    const vikt = siffervik(rad);
    for (const traff of vikt.matchAll(SKANNER)) {
      const [, ar, manad, dag] = traff as unknown as [string, string, string, string];
      registrera(rakning, ar, manad, dag, fangat);
    }
  }

  const ut: Kandidat[] = [];
  for (const [value, { forekomster, lagad }] of rakning) {
    const alder = (fangat.getTime() - new Date(`${value}T12:00:00Z`).getTime()) / 86_400_000;
    ut.push({
      value,
      forekomster,
      lagad,
      confidence: konfidens(forekomster, lagad, alder),
    });
  }
  return ut.sort((a, b) => b.confidence - a.confidence || b.forekomster - a.forekomster);
}

function registrera(
  rakning: Map<string, { forekomster: number; lagad: boolean }>,
  ar: string,
  manad: string,
  dag: string,
  fangat: Date,
): void {
  const rimligt = (a: number, m: number, d: number): boolean => {
    if (!giltigt(a, m, d)) return false;
    const dagar = (fangat.getTime() - Date.UTC(a, m - 1, d, 12)) / 86_400_000;
    // Ett kvitto fotograferas efter köpet. En dags framförhållning för tidszoner.
    return dagar >= -1 && dagar <= 3650;
  };

  const notera = (value: string, lagad: boolean): void => {
    const fanns = rakning.get(value);
    if (fanns) {
      fanns.forekomster++;
      // Lästes samma datum någon gång utan lagning är det inte längre en lagning.
      if (!lagad) fanns.lagad = false;
    } else {
      rakning.set(value, { forekomster: 1, lagad });
    }
  };

  const a = Number(ar);
  const m = Number(manad);
  const d = Number(dag);
  if (rimligt(a, m, d)) {
    notera(`${ar}-${pad(m)}-${pad(d)}`, false);
    return;
  }

  // Kalendern sa nej. Går det att laga med en enda sifferförväxling?
  for (const variant of envariationer(`${ar}${manad}${dag}`)) {
    const va = Number(variant.slice(0, 4));
    const vm = Number(variant.slice(4, 6));
    const vd = Number(variant.slice(6, 8));
    if (rimligt(va, vm, vd)) notera(`${variant.slice(0, 4)}-${variant.slice(4, 6)}-${variant.slice(6, 8)}`, true);
  }
}

/**
 * Samstämmighet dominerar. Ett datum som står tre gånger är nästan säkert rätt även om
 * varje enskild läsning kunde varit fel; ett som står en gång och dessutom behövde
 * lagas är en gissning och ska se ut som en.
 */
function konfidens(forekomster: number, lagad: boolean, alderDagar: number): number {
  let c = 0.45 + Math.min(forekomster, 4) * 0.12;
  if (lagad) c -= 0.2;

  /**
   * Ett kvitto fotograferas efter köpet, aldrig före. Bonusen för "nära fototillfället"
   * får därför bara gälla bakåt.
   *
   * Regeln kom ur ett verkligt fel: `2026-06-31` går att laga både till maj och till
   * augusti, och när fotot togs den 30 augusti fick augustivarianten bonus för att den
   * låg en dag bort — trots att den dagen ligger i framtiden. Ett datum efter fotot är
   * inte ett färskt kvitto, det är ett felläst.
   */
  if (alderDagar < 0) c -= 0.15;
  else if (alderDagar <= 2) c += 0.08;
  else if (alderDagar > 400) c -= 0.1;

  return Math.max(0.05, Math.min(0.97, Math.round(c * 100) / 100));
}
