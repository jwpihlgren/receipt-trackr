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
import { bokstavsvik } from "./tecken.js";

export type Beloppskandidat = {
  value: number;
  confidence: number;
  forekomster: number;
  narNyckelord: number;
  momskontrollerad: boolean;
};

/**
 * Orden som föregår totalen. Två styrkor, för `TOTALT` och `SEK` säger inte lika mycket.
 */
const STARKT = /(?<![A-ZÅÄÖ])(S\s?L\s?U\s?T\s?S\s?U\s?M\s?M\s?A|S\s?U\s?M\s?M\s?A|T\s?O\s?T\s?A\s?L\s?T?|A\s?T\s?T\s+B\s?E\s?T\s?A\s?L\s?A)/g;
const SVAGT = /(?<![A-ZÅÄÖ])(KOEP|K[OÖ]P|GIVET|BETALT|KONTANT|KORT|SEK|BRUTTO|NETS|MOTTAGET|KONTOKORT)\b/g;

/**
 * Hur nära ett nyckelord måste stå för att gälla beloppet.
 *
 * Måttet var förut "samma rad", vilket slutade fungera den dag texten visade sig
 * sakna radbrytningar: hela kvittot blev en rad, varje belopp fick nyckelord, och
 * momskontrollen blev "finns det två tal någonstans som summerar till det här" — vilket
 * nästan alltid går. Kvar blev ren frekvens, och på Søstrene Grene-kvittot vann
 * artikelraden 12,24 över totalen 201,76 därför att den stod tre gånger.
 *
 * Närhet i tecken fungerar med och utan radbrytningar.
 */
const NARHET = 30;

/** Hur brett fönster momsraden får sökas i. */
const MOMSFONSTER = 90;

/** `1 426,45`, `1426.45`, `1426,45`. Tusenavgränsare får vara mellanslag eller punkt. */
const BELOPP = /(\d{1,3}(?:[ .]\d{3})*|\d+)[,.](\d{2})\b/g;

const tal = (heltal: string, decimaler: string): number =>
  Number(`${heltal.replace(/[ .]/g, "")}.${decimaler}`);

export function utvinnBelopp(text: string): Beloppskandidat[] {
  /**
   * Nyckelorden söks i **bokstavsvikt** text, inte siffervikt.
   *
   * Det var tvärtom, och då blev `TOTAL` till `7074L` innan sökningen — så inget
   * belopp fick någonsin ett nyckelord och kvar blev bara frekvens och aritmetik.
   * Åt andra hållet lagas i stället `T0 TAL` till `TO TAL`, och mönstren tål ett
   * mellanslag mellan bokstäverna, för OCR:en spräcker ord mitt itu.
   */
  const ord = bokstavsvik(text.toUpperCase());
  const starka = platser(ord, STARKT);
  const svaga = platser(ord, SVAGT);

  const funna = new Map<number, { forekomster: number; narNyckelord: number; starkt: number }>();
  const belopp: { value: number; index: number }[] = [];

  for (const traff of text.matchAll(BELOPP)) {
    const varde = tal(traff[1]!, traff[2]!);
    // Ören och styckpriser är inte totaler; ett kvitto på under en krona finns inte.
    if (varde < 1 || varde > 1_000_000) continue;
    const index = traff.index ?? 0;
    belopp.push({ value: varde, index });

    const fanns = funna.get(varde) ?? { forekomster: 0, narNyckelord: 0, starkt: 0 };
    fanns.forekomster++;
    if (nara(starka, index)) {
      fanns.narNyckelord++;
      fanns.starkt++;
    } else if (nara(svaga, index)) {
      fanns.narNyckelord++;
    }
    funna.set(varde, fanns);
  }

  // Totalen är summan av kvittots delar och därför sällan mindre än någon av dem. Det
  // skiljer totalen från en momsrads bruttodel, som också stämmer aritmetiskt: på
  // Søstrene Grene-kvittot summerar 33,92 + 8,48 till 42,40 lika sant som hela köpets
  // 201,76 — men bara det ena är vad man betalade.
  const storst = Math.max(...funna.keys());

  const ut: Beloppskandidat[] = [];
  for (const [value, { forekomster, narNyckelord, starkt }] of funna) {
    const momskontrollerad = stammerMedMoms(value, belopp);
    ut.push({
      value,
      forekomster,
      narNyckelord,
      momskontrollerad,
      confidence: konfidens(forekomster, narNyckelord, momskontrollerad, starkt, value === storst),
    });
  }
  return ut.sort((a, b) => b.confidence - a.confidence || b.value - a.value);
}

/** Var i texten orden står. */
function platser(text: string, uttryck: RegExp): number[] {
  return [...text.matchAll(uttryck)].map((t) => t.index ?? 0);
}

/** Står något av orden strax före beloppet? Efter räknas inte — ordet leder talet. */
const nara = (orden: number[], index: number): boolean =>
  orden.some((i) => i <= index && index - i <= NARHET);

/**
 * Brutto = moms + netto. Talen måste stå nära varandra — momsraden är en rad, inte
 * hela kvittot — och summan måste stämma på öret.
 *
 * Slacket var en krona, och det räckte för att `69,90 + 159,60 = 229,50` skulle
 * "bekräfta" beloppet 229,00 på ett Biltema-kvitto. Moms och netto summerar exakt;
 * två öre räcker för avrundning i två led.
 */
function stammerMedMoms(brutto: number, belopp: { value: number; index: number }[]): boolean {
  const mina = belopp.filter((b) => b.value === brutto);
  for (const min of mina) {
    const grannar = belopp.filter((b) => Math.abs(b.index - min.index) <= MOMSFONSTER && b.value !== brutto);
    for (let i = 0; i < grannar.length; i++) {
      for (let j = i + 1; j < grannar.length; j++) {
        if (Math.abs(brutto - (grannar[i]!.value + grannar[j]!.value)) <= 0.02) return true;
      }
    }
  }
  return false;
}

function konfidens(
  forekomster: number,
  narNyckelord: number,
  momskontrollerad: boolean,
  starkt: number,
  storst: boolean,
): number {
  let c = 0.3 + Math.min(forekomster, 5) * 0.05 + Math.min(narNyckelord, 3) * 0.06;
  // `TOTALT 201,76` säger mer än att talet råkar stå tre gånger som artikelpris.
  c += Math.min(starkt, 3) * 0.12;
  // Aritmetik slår upprepning: ett tal som stämmer mot momsraden är kontrollerat.
  if (momskontrollerad) c += 0.15;
  // Störst räknas bara när något annat också pekar dit. Utan den spärren vann
  // `FLEXIBATTS45x555x117 356,45` som 117 356,45 — ett artikelnummer som sprang ihop
  // med priset och blev det största talet på kvittot.
  if (storst && (narNyckelord > 0 || momskontrollerad)) c += 0.1;
  return Math.max(0.05, Math.min(0.97, Math.round(c * 100) / 100));
}
