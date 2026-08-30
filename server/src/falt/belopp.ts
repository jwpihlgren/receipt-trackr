/**
 * Totalbelopp ur råtexten.
 *
 * Beloppet är det fält som står flest gånger på ett kvitto. På Hornbach-kvittot i M5a
 * står `1426,45` som summa, som givet belopp, som kortbelopp och i momsraden — fyra
 * förekomster av samma tal. Det är fyra chanser att få det rätt, inte fyra sätt att
 * bli osäker, och därför bygger utvinningen på samstämmighet i stället för på att
 * hitta den ena rätta raden.
 *
 * Momsraden är dessutom en kvittering: står `1426,45  285,29  1141,16` och de två
 * senare summerar till det första, är beloppet bekräftat av aritmetik och inte bara
 * av upprepning.
 */
import { siffervik } from "./tecken.js";

export type Beloppskandidat = {
  value: number;
  confidence: number;
  forekomster: number;
  narNyckelord: number;
  momskontrollerad: boolean;
};

/** Orden som föregår totalen på svenska kvitton. Ordningen spelar ingen roll. */
const NYCKELORD = /\b(SUMMA|TOTALT?|ATT\s*BETALA|KOEP|K[OÖ]P|GIVET|BETALT|KONTANT|KORT|SEK|BRUTTO)\b/;

/** `1 426,45`, `1426.45`, `1426,45`. Tusenavgränsare får vara mellanslag eller punkt. */
const BELOPP = /(\d{1,3}(?:[ .]\d{3})*|\d+)[,.](\d{2})\b/g;

const tal = (heltal: string, decimaler: string): number =>
  Number(`${heltal.replace(/[ .]/g, "")}.${decimaler}`);

export function utvinnBelopp(text: string): Beloppskandidat[] {
  const rader = text.split(/\n+/);
  const funna = new Map<number, { forekomster: number; narNyckelord: number }>();
  const momssummor: number[][] = [];

  for (const rad of rader) {
    const vikt = siffervik(rad.toUpperCase());
    const harNyckelord = NYCKELORD.test(vikt);
    const iRaden: number[] = [];

    for (const traff of rad.matchAll(BELOPP)) {
      const varde = tal(traff[1]!, traff[2]!);
      // Ören och styckpriser är inte totaler; ett kvitto på under en krona finns inte.
      if (varde < 1 || varde > 1_000_000) continue;
      iRaden.push(varde);
      const fanns = funna.get(varde) ?? { forekomster: 0, narNyckelord: 0 };
      fanns.forekomster++;
      if (harNyckelord) fanns.narNyckelord++;
      funna.set(varde, fanns);
    }
    // Momsraden är tre tal på samma rad där två summerar till det tredje.
    if (iRaden.length >= 3) momssummor.push(iRaden);
  }

  const ut: Beloppskandidat[] = [];
  for (const [value, { forekomster, narNyckelord }] of funna) {
    const momskontrollerad = momssummor.some((rad) => stammerMedMoms(value, rad));
    ut.push({
      value,
      forekomster,
      narNyckelord,
      momskontrollerad,
      confidence: konfidens(forekomster, narNyckelord, momskontrollerad),
    });
  }
  return ut.sort((a, b) => b.confidence - a.confidence || b.value - a.value);
}

/** Brutto = moms + netto, med en krona i slack för avrundning i två led. */
function stammerMedMoms(brutto: number, iRaden: number[]): boolean {
  for (let i = 0; i < iRaden.length; i++) {
    for (let j = 0; j < iRaden.length; j++) {
      if (i === j) continue;
      if (Math.abs(brutto - (iRaden[i]! + iRaden[j]!)) <= 1) return true;
    }
  }
  return false;
}

function konfidens(forekomster: number, narNyckelord: number, momskontrollerad: boolean): number {
  let c = 0.3 + Math.min(forekomster, 5) * 0.07 + Math.min(narNyckelord, 3) * 0.09;
  // Aritmetik slår upprepning: ett tal som stämmer mot momsraden är kontrollerat.
  if (momskontrollerad) c += 0.15;
  return Math.max(0.05, Math.min(0.97, Math.round(c * 100) / 100));
}
