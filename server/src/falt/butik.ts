/**
 * Butiksnamn ur råtexten.
 *
 * Namnet står nästan alltid överst, men det är också där OCR:en har det svårast:
 * logotyper är stiliserade, och M5a gav `HORNBAGH`, `RORNBAGH` och `DHORN BACH` för
 * samma butik. En exakt jämförelse mot en lista hade missat alla tre.
 *
 * **Matchningen går på hela ord, aldrig på delsträngar.** Den gjorde det inte förut,
 * och mätningen mot beställarens 35 egna kvitton 2026-08-30 visade vad det kostade:
 * fem butiker av tjugotre rätt. `St1` matchade inuti `Stiwex`, `Preem` inuti
 * `Premium`, och när texten dessutom saknade radbrytningar blev fallbacken
 * "första raden som ser ut som ett namn" lika med kvittots sextio första tecken.
 *
 * Två steg, som förut: en känd kedja matchas tolerant, och först om ingen kedja känns
 * igen faller vi tillbaka på ett namn ur toppen. Skillnaden är att båda stegen nu
 * räknar i ord.
 */
import { jamforbar, ord } from "./tecken.js";

export type Butikskandidat = { value: string; confidence: number; kand: boolean };

/**
 * Listan är hushållets, inte Sveriges. Den växte 2026-08-30 med de kedjor som faktiskt
 * fanns i beställarens egen hög — det är precis så den ska växa.
 */
export const KEDJOR = [
  "ICA", "Coop", "Willys", "Hemköp", "Lidl", "Netto", "City Gross", "Matöppet",
  "Byggmax", "Hornbach", "Bauhaus", "K-Rauta", "Beijer", "Jula", "Biltema", "Clas Ohlson",
  "Flügger", "Colorama", "Däckskiftarna", "Fresks", "Optimera",
  "Systembolaget", "Apoteket", "Kronans Apotek", "Apotek Hjärtat",
  "Kjell & Company", "Elgiganten", "NetOnNet", "Media Markt",
  "Pressbyrån", "7-Eleven", "Espresso House", "Waynes Coffee",
  "Circle K", "OKQ8", "Ingo", "Preem", "Shell", "St1", "Tesla",
  "IKEA", "Rusta", "Dollarstore", "Åhléns", "Stadium", "XXL", "Intersport",
  "H&M", "Lindex", "KappAhl", "Dressmann", "Eurosko", "Søstrene Grene",
  "Granngården", "Plantagen", "Blomsterlandet",
] as const;

/** Ord som sammanfattar i stället för att namnge. En kedja som bara står här är ett sammanträffande. */
const SUMMERINGSORD = new Set(["BRUTTO", "MOMS", "MOMS%", "NETTO", "SUMMA", "TOTALT", "TOTAL", "MERVARDESSKATT"]);

/** Hur nära en summeringspost ett namn får stå innan det räknas som en del av den. */
const SUMMERINGSFONSTER = 3;

/**
 * Ord som aldrig är ett butiksnamn, men som ofta står först på ett kvitto eller på en
 * kortslip. Utan dem blev "KUNDENS EXEMPLAR KÖP Flügger …" ett butiksnamn.
 */
const INTE_NAMN = new Set([
  "KUNDENS", "EXEMPLAR", "KOPIA", "KVITTOKOPIA", "KASSAKVITTO", "RETURKVITTO", "KVITTO",
  "KOP", "KÖP", "SPARA", "ORIGINAL", "KORT", "MASTERCARD", "VISA", "BANKKORT", "NETS",
  "TEL", "TELEFON", "ORG", "ORGNR", "MOMS", "NETTO", "BRUTTO", "TOTALT", "TOTAL", "SEK",
  "DATUM", "TID", "KASSA", "SLIP", "TRANS", "PERSON", "SALJARE", "STAFF", "DEBIT",
  "ALL", "OVER", "THE", "AB", "DEN", "DET", "OCH",
]);

/** Ord som visar att vi lämnat namnet och kommit till adressen. */
const ADRESSORD = /(VAGEN|VÄGEN|GATAN|GATA|VAG|VÄG|TORGET|PLATSEN|ALLEN|ALLÉN|BACKEN)$/;

/**
 * Hur många tecken som får skilja innan två ord inte längre är samma ord.
 *
 * Toleransen måste skala med längden, annars blir den absurd på korta namn: två fel i
 * `LIDL` är halva ordet. Under fem tecken tillåts ingen tolerans alls — `ICA`, `Coop`
 * och `Lidl` matchas exakt eller inte alls, och det är rätt: ett tre bokstävers ord
 * som nästan stämmer stämmer inte.
 */
const tolerans = (nyckel: string): number => (nyckel.length >= 7 ? 2 : nyckel.length >= 5 ? 1 : 0);

/**
 * Namn vars ord alla är kortare än tre tecken kan inte matchas på ord — `H&M` blir
 * `H M` efter normaliseringen, och två enbokstavsord står bredvid varandra på nästan
 * varje kvitto. De söks i stället ordagrant i råtexten, med skiljetecken och allt.
 */
const barаKorta = (delar: string[]): boolean => delar.every((d) => d.length < 3);

export function utvinnButik(text: string): Butikskandidat[] {
  const orden = ord(text);
  if (orden.length === 0) return [];
  const rå = text.toUpperCase();
  const ut: Butikskandidat[] = [];

  for (const kedja of KEDJOR) {
    const delar = jamforbar(kedja).split(" ").filter(Boolean);
    if (delar.length === 0) continue;

    if (barаKorta(delar)) {
      // `H&M`, `St1`, `XXL`: ordagrant, med skiljetecken. Ingen tolerans, inga delord.
      const traff = new RegExp(`(?<![A-ZÅÄÖ0-9])${kedja.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-ZÅÄÖ0-9])`);
      if (traff.test(rå)) ut.push({ value: kedja, confidence: 0.8, kand: true });
      continue;
    }

    const platser = hitta(orden, delar);
    if (platser.length === 0) continue;

    /**
     * `NETTO` står i momsraden på varje svenskt kvitto och gjorde Hornbach till en
     * Netto-butik. Signalen är grannskapet, inte radpositionen: ett namn som bara
     * förekommer en gång, och då mitt i en summering, är inte butiken.
     */
    if (platser.length === 1 && iSummering(orden, platser[0]!, delar.length)) continue;

    // Tidigt i texten väger tyngre: butiken står i huvudet, inte i sidfoten.
    const tidigast = Math.min(...platser);
    const tidigt = tidigast < Math.max(8, orden.length * 0.2);
    const exakt = platser.some((i) => delar.every((d, j) => orden[i + j] === d));
    const bas = exakt ? 0.74 : 0.62;
    ut.push({
      value: kedja,
      confidence: Math.min(0.95, bas + (platser.length - 1) * 0.06 + (tidigt ? 0.08 : 0)),
      kand: true,
    });
  }

  if (ut.length === 0) {
    const gissad = gissaNamn(text);
    if (gissad) ut.push({ value: gissad, confidence: 0.3, kand: false });
  }

  return ut.sort((a, b) => b.confidence - a.confidence);
}

/** Var i ordlistan namnets ord står, exakt eller inom toleransen. */
function hitta(orden: string[], delar: string[]): number[] {
  const platser: number[] = [];
  for (let i = 0; i + delar.length <= orden.length; i++) {
    if (delar.every((del, j) => likа(orden[i + j]!, del))) platser.push(i);
  }
  return platser;
}

const likа = (ordet: string, del: string): boolean =>
  ordet === del || avstand(ordet, del, tolerans(del)) <= tolerans(del);

function iSummering(orden: string[], plats: number, langd: number): boolean {
  const fran = Math.max(0, plats - SUMMERINGSFONSTER);
  const till = Math.min(orden.length, plats + langd + SUMMERINGSFONSTER);
  return orden.slice(fran, till).some((o) => SUMMERINGSORD.has(o));
}

/**
 * Ingen känd kedja. Ta namnet ur toppen: de första orden som ser ut som ett namn och
 * inte som en rubrik, ett postnummer eller en adress.
 *
 * Hellre ingenting än fel. Ett kvitto vars huvud är bortklippt — en kortslip som
 * börjar med `Moms% … Net.bel.` — har inget namn att ge, och då är tomt rätt svar:
 * fältet fylls i stället av de andra fotona av samma kvitto.
 */
function gissaNamn(text: string): string | null {
  const rader = text.split(/\n+/).flatMap((r) => r.split(/\s{2,}/));
  const kandidater = rader.length > 1 ? rader.slice(0, 4) : [text];

  for (const rad of kandidater) {
    const rått = rad.trim().split(/\s+/);
    const namn: string[] = [];
    /**
     * Bara de tre första orden. Butiken står först eller inte alls — och ett kvitto
     * vars huvud saknas ska ge tomt, inte det första ord längre ned som råkar se ut
     * som ett namn. `ALL OVER THE WORLD Allum …` gav annars butiken "WORLD Allum".
     */
    for (const bit of rått.slice(0, 3)) {
      const rent = jamforbar(bit);
      if (!rent) continue;
      // Inledande skräp och enbokstavsrester hoppas över, men bryter inte namnet.
      if (namn.length === 0 && (rent.length < 3 || INTE_NAMN.has(rent) || /\d/.test(bit))) continue;
      if (namn.length > 0 && (INTE_NAMN.has(rent) || ADRESSORD.test(rent) || /\d/.test(bit))) break;
      if (!/[A-ZÅÄÖ]{3}/.test(rent)) break;
      namn.push(bit.replace(/[^\p{L}\p{N}&.\-']/gu, ""));
      // Ett ord räcker nästan alltid. Ett andra tas bara när det första är kort.
      if (namn.join(" ").length >= 6) break;
    }
    const value = namn.join(" ").trim();
    if (value.length >= 3) return value.slice(0, 30);
  }
  return null;
}

/** Levenshtein med tak: avbryter så fort avståndet inte kan bli litet nog. */
function avstand(a: string, b: string, tak: number): number {
  if (tak === 0) return a === b ? 0 : 1;
  if (Math.abs(a.length - b.length) > tak) return tak + 1;
  let forra = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const rad = [i];
    let minsta = i;
    for (let j = 1; j <= b.length; j++) {
      const kostnad = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(forra[j]! + 1, rad[j - 1]! + 1, forra[j - 1]! + kostnad);
      rad.push(v);
      if (v < minsta) minsta = v;
    }
    if (minsta > tak) return tak + 1;
    forra = rad;
  }
  return forra[b.length]!;
}
