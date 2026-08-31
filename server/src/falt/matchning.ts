/**
 * Vilka kvitton som är samma köp.
 *
 * Beställarens hög gav svaret på varför det behövs: av 35 foton var tolv dubbletter i
 * fem grupper. Tre foton av samma Colorama-kvitto, två av samma Byggmax — och ett par
 * där kvittot och kortslippen är två olika papper från samma köp.
 *
 * **Sammanfogning är inte städning, det är bevis.** Tre läsningar av samma papper är
 * tre chanser att få butiken rätt, och exakt det behövs: två av de tolv läste inget
 * butiksnamn alls, medan deras syskon läste det korrekt.
 *
 * Asymmetrin styr varje regel här. En felaktig sammanslagning **döljer ett köp** och
 * går inte att upptäcka i efterhand. En missad dubblett kostar en rad i arkivet. Därför
 * spärrar först, ankare sedan, och ingenting slås ihop på en gissning.
 */
import type { Identitet } from "./identitet.js";

export type Nyckel = {
  id: string;
  orgnr?: string;
  kvittonummer?: string;
  datum?: string;
  tid?: string;
  belopp?: number;
  kortref?: string[];
};

/**
 * `saker`  — samma transaktion, bevisad av ett nummer som är unikt per köp.
 * `stark`  — samma bolag, dag, belopp och minut. Två skilda köp som stämmer på alla
 *            fyra existerar inte.
 * `svag`   — samma bolag, dag och belopp, men inget klockslag. Kan vara två köp.
 */
export type Niva = "saker" | "stark" | "svag";

/** Hur många minuter kvittots klocka och kortterminalens får skilja. */
const MINUTER = 15;

export function matchar(a: Nyckel, b: Nyckel): Niva | null {
  if (a.id === b.id) return null;

  // ---- Spärrar. Passeras en av dem är det två köp, oavsett vad annat stämmer. ----
  if (skiljer(a.belopp, b.belopp)) return null;
  if (skiljer(a.orgnr, b.orgnr)) return null;
  if (skiljer(a.datum, b.datum)) return null;

  /**
   * Kvittonumret spärrar inte. Det är starkt när det läses rätt och sönderläst
   * ibland — `0000022446000000771` blev `0224360000771` på ett av beställarens tre
   * foton av samma kvitto. Ett fält som ibland ljuger får peka, aldrig hindra;
   * spärren bärs av belopp, bolag och dag, som läses tillförlitligt.
   */

  // ---- Ankare ----
  // Kortterminalens referens är unik per transaktion och finns även på slippen.
  if (delarKortref(a, b)) return "saker";

  // Utan samma dag och samma belopp finns ingen match på någon nivå.
  const grunden = samma(a.datum, b.datum) && samma(a.belopp, b.belopp);
  if (!grunden) return null;

  if (samma(a.kvittonummer, b.kvittonummer)) return "saker";

  /**
   * Ett kvittonummer som *nästan* stämmer är ett felläst kvittonummer, inte ett annat
   * kvitto: `0000022446000000771` blev `0224360000771` på det tredje fotot av samma
   * papper. Tolerans bara för långa nummer — `27` och `28` skiljer sig också med ett
   * tecken, och de är två olika köp.
   */
  if (liknandeNummer(a.kvittonummer, b.kvittonummer)) return "stark";

  /**
   * Samma minut och samma belopp räcker även utan organisationsnummer. Søstrene Grene
   * skriver inget orgnr på kvittot, och de två fotona hade inget annat gemensamt att
   * gå på. Två skilda köp på samma öre i samma minut finns inte.
   */
  if (naraITid(a.tid, b.tid)) return "stark";

  // Kvar: samma bolag, dag och belopp, men ingen klocka. Kan vara två köp.
  return samma(a.orgnr, b.orgnr) ? "svag" : null;
}

/** Minsta längd innan ett kvittonummer får jämföras tolerant. */
const TOLERANSGOLV = 6;

function liknandeNummer(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const rensa = (v: string): string => v.replace(/\D/g, "").replace(/^0+/, "");
  const x = rensa(a);
  const y = rensa(b);
  if (x.length < TOLERANSGOLV || y.length < TOLERANSGOLV) return false;
  const tak = Math.max(1, Math.floor(Math.max(x.length, y.length) * 0.25));
  return avstand(x, y, tak) <= tak;
}

/** Levenshtein med tak. */
function avstand(a: string, b: string, tak: number): number {
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

/**
 * Grupperna, som transitivt hölje över det som får slås ihop. `svag` binder inte.
 *
 * `spard` är en människas nej: har någon sagt att två kvitton inte är samma köp får
 * ingen kedja gå genom det paret. Det väger tyngre än varje ankare — hon har sett
 * papperen, matchningen har sett siffror.
 */
export function gruppera(
  nycklar: Nyckel[],
  minst: Niva = "stark",
  spard: (a: string, b: string) => boolean = () => false,
): string[][] {
  const ordning: Niva[] = ["svag", "stark", "saker"];
  const kravet = ordning.indexOf(minst);

  const rot = new Map(nycklar.map((n) => [n.id, n.id]));
  const finn = (id: string): string => {
    let r = id;
    while (rot.get(r) !== r) r = rot.get(r)!;
    return r;
  };

  for (let i = 0; i < nycklar.length; i++) {
    for (let j = i + 1; j < nycklar.length; j++) {
      if (spard(nycklar[i]!.id, nycklar[j]!.id)) continue;
      const niva = matchar(nycklar[i]!, nycklar[j]!);
      if (niva === null || ordning.indexOf(niva) < kravet) continue;
      const a = finn(nycklar[i]!.id);
      const b = finn(nycklar[j]!.id);
      if (a !== b) rot.set(b, a);
    }
  }

  const grupper = new Map<string, string[]>();
  for (const n of nycklar) {
    const r = finn(n.id);
    grupper.set(r, [...(grupper.get(r) ?? []), n.id]);
  }
  // Bara grupper med mer än en medlem är grupper.
  return [...grupper.values()].filter((g) => g.length > 1).map((g) => [...g].sort());
}

/** Bygger en nyckel av det arkivet redan vet om ett kvitto. */
export function nyckel(
  id: string,
  identitet: Identitet,
  falt: { datum?: string; belopp?: number },
): Nyckel {
  return {
    id,
    ...(identitet.orgnr ? { orgnr: identitet.orgnr } : {}),
    ...(identitet.kvittonummer ? { kvittonummer: identitet.kvittonummer } : {}),
    ...(identitet.tid ? { tid: identitet.tid } : {}),
    ...(identitet.kortref?.length ? { kortref: identitet.kortref } : {}),
    ...(falt.datum ? { datum: falt.datum } : {}),
    ...(falt.belopp === undefined ? {} : { belopp: falt.belopp }),
  };
}

/** Två värden som båda finns och inte är lika. Saknas ett av dem skiljer de inte. */
const skiljer = <T>(a: T | undefined, b: T | undefined): boolean =>
  a !== undefined && b !== undefined && a !== b;

/** Två värden som båda finns och är lika. Saknas ett av dem är svaret nej. */
const samma = <T>(a: T | undefined, b: T | undefined): boolean =>
  a !== undefined && b !== undefined && a === b;

/**
 * Hur lång en referens måste vara för att ensam bevisa att två kvitton är samma köp.
 *
 * Kortterminalens referens kommer i två former, och bara den ena är en identitet.
 * `031232001580` är dag, klockslag och löpnummer — unik i praktiken. En sexsiffrig
 * auktoriseringskod är det inte: den är utgivarens löpnummer, och räknar man
 * födelsedagsproblemet på tiotusen kvitton i ett rum av en miljon koder väntas ett
 * femtiotal krockar. De flesta stoppas av att beloppen skiljer, men ett kvitto vars
 * belopp inte gick att läsa har ingen sådan spärr — och en felaktig sammanslagning
 * döljer ett köp utan att någonsin synas.
 *
 * En kort referens är alltså inget ankare. Den står kvar i identiteten som något en
 * människa kan läsa, men den binder inte ihop två kvitton på egen hand: då krävs
 * samma dag och samma belopp som för alla andra.
 */
const REF_GOLV = 8;

const delarKortref = (a: Nyckel, b: Nyckel): boolean => {
  const langa = (n: Nyckel): string[] => (n.kortref ?? []).filter((r) => r.length >= REF_GOLV);
  const bs = new Set(langa(b));
  return langa(a).some((r) => bs.has(r));
};

/**
 * Kvittots klocka och kortterminalens är inte samma klocka. På beställarens
 * Flügger-köp står 12:28 på kvittot och 12:32 på slippen — samma köp, fyra minuter.
 */
function naraITid(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const min = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.abs(min(a) - min(b)) <= MINUTER;
}
