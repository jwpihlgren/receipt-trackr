/**
 * Fältutvinningen: råtext in, fält ut.
 *
 * Den körs på **servern**, inte på klienten, och det är ett avsiktligt val. Utvinningen
 * är ren textbehandling — några reguljära uttryck och lite räkning — medan OCR:en är
 * tung och därför bor på telefonen. Skillnaden får en följd som är värd hela beslutet:
 * blir reglerna bättre går det att köra `reindex` och få alla kvitton omtolkade utan
 * att en enda bild behöver läsas om.
 *
 * Formen på ett fält bär tre saker: värdet, hur säkert det är, och varifrån det kom.
 * Det sista är inte prydnad. Gränssnittet markerar maskinläst värde med prickad
 * understrykning och bekräftat utan markör, och den skillnaden går inte att visa om
 * fältet bara är ett värde.
 */
import { utvinnButik } from "./butik.js";
import { utvinnBelopp } from "./belopp.js";
import { utvinnDatum } from "./datum.js";

export type Kalla = "ocr" | "manual" | "confirmed";

export type Falt<T> = {
  value: T;
  confidence: number;
  source: Kalla;
  /** Övriga läsningar, rankade. Det är dem gränssnittet visar som "Även läst som". */
  candidates?: { value: T; confidence: number }[];
};

export type Falten = {
  store?: Falt<string>;
  date?: Falt<string>;
  total?: Falt<number>;
  currency?: Falt<string>;
};

/** Hur många alternativ som sparas per fält. Fler blir en lista ingen läser. */
const ALTERNATIV = 3;

function falt<T>(kandidater: { value: T; confidence: number }[]): Falt<T> | undefined {
  const [basta, ...resten] = kandidater;
  if (!basta) return undefined;
  const ovriga = resten.slice(0, ALTERNATIV).map((k) => ({ value: k.value, confidence: k.confidence }));
  return {
    value: basta.value,
    confidence: basta.confidence,
    source: "ocr",
    ...(ovriga.length ? { candidates: ovriga } : {}),
  };
}

export function utvinn(text: string, capturedAt: string): Falten {
  if (!text.trim()) return {};

  const butik = falt(utvinnButik(text));
  const datum = falt(utvinnDatum(text, capturedAt));
  const belopp = falt(utvinnBelopp(text));

  return {
    ...(butik ? { store: butik } : {}),
    ...(datum ? { date: datum } : {}),
    ...(belopp ? { total: belopp } : {}),
    // Allt i arkivet är svenska kvitton. Står det inget annat är det kronor, och att
    // låtsas utvinna det ur texten vore att bygga en regel för ett problem som inte finns.
    ...(belopp ? { currency: { value: "SEK", confidence: 0.9, source: "ocr" as const } } : {}),
  };
}

/**
 * Behåller det en människa bestämt och räknar om resten. Utan den regeln skulle en
 * förbättrad regeluppsättning skriva över rättelser, och då vore varje `reindex` ett
 * sätt att förlora arbete.
 */
export function utvinnUtanAttSkrivaOver(text: string, capturedAt: string, befintliga: Falten): Falten {
  const nya = utvinn(text, capturedAt);
  const ut: Record<string, unknown> = { ...nya };
  for (const [namn, falt] of Object.entries(befintliga) as [string, Falt<unknown> | undefined][]) {
    if (falt && (falt.source === "manual" || falt.source === "confirmed")) ut[namn] = falt;
  }
  return ut as Falten;
}
