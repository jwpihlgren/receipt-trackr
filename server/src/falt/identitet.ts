/**
 * Kvittots identitet: det som skiljer *det här köpet* från ett annat.
 *
 * Butik, datum och belopp beskriver vad man handlade. De räcker inte för att avgöra om
 * två foton visar samma papper — två köp på Byggmax samma dag på samma summa är fullt
 * möjliga. Det som avgör är kvittots egna maskinsatta nummer, och de har en egenskap
 * som butiksnamnet saknar: de är siffror, och OCR:en läser siffror bra.
 *
 * Fyra ankare, mätta mot beställarens 35 kvitton:
 *
 *   `orgnr`         — bolaget. Har en Luhn-kontrollsiffra, så en felläst siffra går att
 *                     **förkasta** i stället för att misstänkas. Det gör det till det
 *                     enda fältet i hela arkivet som validerar sig självt.
 *   `kvittonummer`  — unikt per kassa och dag.
 *   `tid`           — klockslaget. Skiljer två köp samma dag åt.
 *   `kortref`       — kortterminalens referens eller auktoriseringskod. I praktiken
 *                     unik per transaktion, och den finns även på kortslippen när
 *                     varulistan saknas.
 *
 * Ingen av dem är obligatorisk. Ett kvitto utan ankare matchas inte, och det är rätt:
 * hellre två rader i arkivet än två köp hopslagna till ett.
 */

import { bokstavsvik } from "./tecken.js";

export type Identitet = {
  orgnr?: string;
  kvittonummer?: string;
  tid?: string;
  kortref?: string[];
};

/** Tio siffror som får vara brutna av skiljetecken, men inte av bokstäver eller radslut. */
const TIO_SIFFROR = /(?<![0-9])(?:SE)?([0-9][0-9 .,\-–]{8,14}[0-9])(?![0-9])/gi;

/** Ord som säger att talet efter dem är ett organisationsnummer. */
const ORGORD = /(ORG\.?\s?N|ORGANISATIONSN|MOMS\s?REG|VAT|MVA)/i;

/**
 * Ordet söks i **bokstavsvikt** text — `Kv1tto` blir `KVITTO` — och tål ett mellanslag
 * mellan bokstäverna, för OCR:en spräcker ord mitt itu. Värdet plockas ur originalet
 * på samma offset: vikningen är 1:1 per tecken, så siffrorna står kvar orörda.
 */
const KVITTOORD = /(?:K\s?V\s?I\s?T\s?T\s?O\s?(?:N\s?U\s?M\s?M\s?E\s?R|N\s?R)?|S\s?L\s?I\s?P|B\s?O\s?N\s?G)/g;

/** Numret självt, läst ur **originalet** direkt efter ordet. */
const KVITTOVARDE = /^[.:\s()]*([A-Z]{0,3}\s?[0-9][0-9A-Z\-]{1,24})/;

const TID = /(?<![0-9:])([01][0-9]|2[0-3])[:.]([0-5][0-9])(?![0-9])/g;

/** Kortterminalens referens. Flera former, alla lika starka. */
const KORTREF = /(?:REF|AUKT\.?\s?KOD|AUKT\.?\s?KAD|AUTH\.?\s?CODE|AUTHCODE)[.:\s]*([0-9][0-9\s]{4,20}[0-9])/gi;

/**
 * Luhn över tio siffror. Svenska organisationsnummer bär samma kontrollsiffra som
 * personnummer, och den är hela poängen: ett tal som inte stämmer är felläst, inte
 * osäkert, och ska aldrig bli ett ankare.
 */
export function luhn(siffror: string): boolean {
  if (!/^\d{10}$/.test(siffror)) return false;
  let summa = 0;
  for (let i = 0; i < 10; i++) {
    const d = Number(siffror[i]);
    // Vartannat tal fördubblas, med start på det första — tio siffror räknas jämnt.
    const v = i % 2 === 0 ? d * 2 : d;
    summa += v > 9 ? v - 9 : v;
  }
  return summa % 10 === 0;
}

/** `5566456215` → `556645-6215`. En form, så att två läsningar går att jämföra. */
const formatera = (siffror: string): string => `${siffror.slice(0, 6)}-${siffror.slice(6)}`;

export function utvinnIdentitet(text: string): Identitet {
  const ut: Identitet = {};

  const orgnr = hittaOrgnr(text);
  if (orgnr) ut.orgnr = orgnr;

  const kvittonummer = forstaKvittonummer(text);
  if (kvittonummer) ut.kvittonummer = kvittonummer;

  const tid = forstaTid(text);
  if (tid) ut.tid = tid;

  const refs = [...new Set([...text.matchAll(KORTREF)].map((t) => t[1]!.replace(/\s+/g, "")))]
    .filter((r) => r.length >= 5)
    .slice(0, 4);
  if (refs.length) ut.kortref = refs;

  return ut;
}

/**
 * Organisationsnumret. Alla tiosiffriga tal prövas mot Luhn; står ett `Org.nr` strax
 * före vinner det över ett som bara råkade stämma. Ett kortnummer eller en terminal-id
 * klarar Luhn ungefär var tionde gång, och utan ordet är det just den risken som står.
 */
function hittaOrgnr(text: string): string | undefined {
  let utanOrd: string | undefined;
  for (const traff of text.matchAll(TIO_SIFFROR)) {
    const siffror = traff[1]!.replace(/\D/g, "");
    // `SE556094326701` är momsnumret: samma organisationsnummer med SE före och 01 efter.
    const kandidater = siffror.length === 12 ? [siffror.slice(0, 10)] : siffror.length === 10 ? [siffror] : [];
    for (const kandidat of kandidater) {
      if (!luhn(kandidat)) continue;
      const fore = text.slice(Math.max(0, (traff.index ?? 0) - 22), traff.index ?? 0);
      if (ORGORD.test(fore)) return formatera(kandidat);
      utanOrd ??= formatera(kandidat);
    }
  }
  return utanOrd;
}

/**
 * Ordet söks i **bokstavsvikt** text — `Kv1tto` blir `KVITTO`, och mönstret tål ett
 * mellanslag mitt i ordet eftersom OCR:en spräcker ord. Numret läses sedan ur
 * **originalet** direkt efter ordet: vikningen gör om siffror till bokstäver, så
 * `CO1213-00342257` hade blivit `COIZIE OOEAZZST` om den fått gälla värdet också.
 * Vikningen är 1:1 per tecken, så positionerna stämmer mellan de två texterna.
 */
function forstaKvittonummer(text: string): string | undefined {
  const stort = text.toUpperCase();
  const vikt = bokstavsvik(stort);
  for (const traff of vikt.matchAll(KVITTOORD)) {
    const slut = (traff.index ?? 0) + traff[0]!.length;
    const varde = KVITTOVARDE.exec(stort.slice(slut, slut + 40));
    if (!varde) continue;
    const rått = varde[1]!.replace(/\s+/g, "");
    if (rått.replace(/\D/g, "").length >= 2) return rått;
  }
  return undefined;
}

/**
 * Första klockslaget. Kvittot skriver sin egen tid först och kortterminalens sedan —
 * de skiljer sig med en minut och det spelar ingen roll, för matchningen jämför inte
 * på sekunden.
 */
function forstaTid(text: string): string | undefined {
  const traff = TID.exec(text);
  TID.lastIndex = 0;
  return traff ? `${traff[1]}:${traff[2]}` : undefined;
}
