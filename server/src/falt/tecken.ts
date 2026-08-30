/**
 * Hopvikning av tecken OCR:en förväxlar.
 *
 * Listan är inte allmän utan mätt: den kommer ur råtexten från M5a på verkliga svenska
 * kvitton. `0RG.NR` för `ORG.NR`, `1s0` för `150`, `S1yck` för `Styck`, `TE0N` för
 * `TERM`. Förväxlingarna går åt båda hållen och beror på sammanhanget — i ett tal är
 * `O` nästan alltid en nolla, i ett ord är `0` nästan alltid ett O.
 *
 * Därför två funktioner i stället för en tabell: den ena viker mot siffror, den andra
 * mot bokstäver. Att vika åt fel håll gör mer skada än att inte vika alls.
 */

/** Tecken som läses som siffror när de står i ett tal. */
const TILL_SIFFRA: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", i: "1", "|": "1", "!": "1",
  Z: "2", z: "2",
  E: "3",
  A: "4",
  S: "5", s: "5",
  G: "6", b: "6",
  T: "7",
  B: "8",
  g: "9", q: "9",
};

/** Tecken som läses som bokstäver när de står i ett ord. */
const TILL_BOKSTAV: Record<string, string> = {
  "0": "O", "1": "I", "5": "S", "8": "B", "6": "G", "2": "Z", "4": "A", "3": "E",
};

export const siffervik = (s: string): string =>
  [...s].map((c) => TILL_SIFFRA[c] ?? c).join("");

export const bokstavsvik = (s: string): string =>
  [...s].map((c) => TILL_BOKSTAV[c] ?? c).join("");

/**
 * Siffror som byts mot varandra i praktiken. Används för att laga ett datum som en
 * kalender förkastat: `2026-06-31` blir giltigt som `2026-05-31`, och det är precis
 * det felet som stod i mätfilen bredvid tre segment som läste `05` rätt.
 */
export const SIFFERPAR: Record<string, string[]> = {
  "0": ["8", "6", "9"],
  "1": ["7", "4"],
  "2": ["7"],
  "3": ["8", "9"],
  "4": ["1", "9"],
  "5": ["6", "8", "3"],
  "6": ["5", "8", "0"],
  "7": ["1", "2"],
  "8": ["0", "6", "3", "5"],
  "9": ["0", "4", "3"],
};

/** Alla varianter av en sifferföljd där exakt en siffra bytts mot en förväxling. */
export function envariationer(siffror: string): string[] {
  const ut: string[] = [];
  for (let i = 0; i < siffror.length; i++) {
    for (const ersattning of SIFFERPAR[siffror[i]!] ?? []) {
      ut.push(siffror.slice(0, i) + ersattning + siffror.slice(i + 1));
    }
  }
  return ut;
}

/** Normaliserar för jämförelse: versaler, hopvikta bokstäver, inga extra mellanrum. */
export const jamforbar = (s: string): string =>
  bokstavsvik(s.toUpperCase()).replace(/[^A-ZÅÄÖ0-9]+/g, " ").trim();
