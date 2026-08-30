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

type Rakning = { forekomster: number; lagad: boolean; anger: number };

/**
 * Datum och tid springer ihop i kvittotext: `2026-05-2516 46`, `2026-05-3115020026`.
 * Skannern tar därför åtta siffror i följd och bryr sig inte om vad som kommer sedan.
 *
 * Tre former, för alla tre står på beställarens kvitton: `2026-05-25`, `03 06 2026`
 * och `Date: 26-07-10`. Den sista är tvetydig i teorin och entydig i praktiken — en
 * tvåsiffrig del som är 20–39 är ett årtal, för inget kvitto i arkivet är från 1900-talet.
 * Vilken tolkning som överlever avgörs ändå av kalendern och av fototillfället.
 */
/**
 * Uttrycken är **nollbreddiga**: allt ligger i en lookahead, så en träff förbrukar
 * ingenting och skanningen går vidare ett tecken i taget.
 *
 * Det är inte en finess utan en rättelse. Ett girigt uttryck läste `Kvitto 618057
 * 2026-04-26` som `618057 20` — ett omöjligt datum som kalendern förkastade — och
 * eftersom träffen förbrukade tecknen försvann det riktiga datumet med den. Kvittot
 * fick i stället ångerfristens datum längst ned. Det här är sannolikt en del av
 * datumsvagheten M0 mätte till 74 %.
 */
const ARET_FORST = /(?<!\d)(?=(\d{4})[-./ ]?(\d{2})[-./ ]?(\d{2}))/g;
const DAGEN_FORST = /(?<!\d)(?=(\d{2})[-./ ]?(\d{2})[-./ ]?(\d{4})(?!\d))/g;
const KORT_AR = /(?<!\d)(?=(2\d)[-./](\d{2})[-./](\d{2})(?!\d))/g;

/**
 * Ord som gör ett datum till något annat än ett inköpsdatum: ångerfristen, garantins
 * slut, sista dagen för återköp. Beställarens Blomsterlandet-kvitto lästes som
 * 2026-05-26 därför att `öppet köp t.o.m` stod före det datumet; köpet skedde 04-26.
 */
const ANGERORD = /(ÖPPET\s*KÖP|OPPET\s*KOP|SISTA\s*DAG|ÅTERKÖP|ATERKOP|BYTESRÄTT|BYTESRATT|GARANTI|GÄLLER\s*T|T\.?O\.?M)/;

/** Hur långt före ett datum ett ångerord får stå för att gälla det. */
const ANGERFONSTER = 40;

/**
 * Bokstäver viks till siffror **bara i ord som redan är mest siffror**.
 *
 * `siffervik` skrevs för en datumrad och fick i stället hela kvittot, sedan texten
 * visade sig sakna radbrytningar. Då blir `Bonusgrundande` till `80nu56run04n03`, och
 * ur prosan växer åttasiffriga tal som ser ut som datum. Vikningen är 1:1 per tecken,
 * så positionerna i texten står kvar och ångerorden går fortfarande att hitta.
 */
function vikTal(text: string): string {
  return text.replace(/\S+/g, (bit) => {
    const siffror = (bit.match(/\d/g) ?? []).length;
    return siffror >= 2 && siffror >= bit.length / 3 ? siffervik(bit) : bit;
  });
}

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
  const rakning = new Map<string, Rakning>();

  const vikt = vikTal(text);
  const skanna = (uttryck: RegExp, ordning: [number, number, number]): void => {
    for (const traff of vikt.matchAll(uttryck)) {
      const [ai, mi, di] = ordning;
      const index = traff.index ?? 0;
      // Ett datum efter "öppet köp t.o.m" är ångerfristens sista dag, inte köpets.
      const fore = vikt.slice(Math.max(0, index - ANGERFONSTER), index).toUpperCase();
      registrera(rakning, traff[ai]!, traff[mi]!, traff[di]!, fangat, ANGERORD.test(fore));
    }
  };

  skanna(ARET_FORST, [1, 2, 3]);
  skanna(DAGEN_FORST, [3, 2, 1]);
  skanna(KORT_AR, [1, 2, 3]);

  const ut: Kandidat[] = [];
  for (const [value, { forekomster, lagad, anger }] of rakning) {
    const alder = (fangat.getTime() - new Date(`${value}T12:00:00Z`).getTime()) / 86_400_000;
    ut.push({
      value,
      forekomster,
      lagad,
      // Står datumet *bara* efter ett ångerord är det inte kvittots datum.
      confidence: konfidens(forekomster, lagad, alder, anger === forekomster),
    });
  }
  return ut.sort((a, b) => b.confidence - a.confidence || b.forekomster - a.forekomster);
}

function registrera(
  rakning: Map<string, Rakning>,
  ar: string,
  manad: string,
  dag: string,
  fangat: Date,
  anger: boolean,
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
      if (anger) fanns.anger++;
      // Lästes samma datum någon gång utan lagning är det inte längre en lagning.
      if (!lagad) fanns.lagad = false;
    } else {
      rakning.set(value, { forekomster: 1, lagad, anger: anger ? 1 : 0 });
    }
  };

  const a = Number(ar.length === 2 ? `20${ar}` : ar);
  const m = Number(manad);
  const d = Number(dag);
  if (rimligt(a, m, d)) {
    notera(`${a}-${pad(m)}-${pad(d)}`, false);
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
function konfidens(forekomster: number, lagad: boolean, alderDagar: number, baraAnger: boolean): number {
  let c = 0.45 + Math.min(forekomster, 4) * 0.12;
  if (lagad) c -= 0.2;
  // Ångerfristens datum konkurrerar inte med köpets — det är ett annat fält.
  if (baraAnger) c -= 0.35;

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
