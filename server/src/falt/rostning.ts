/**
 * Fälten för en grupp kvitton som visar samma köp.
 *
 * Det är här sammanfogningen betalar sig. Tre foton av samma papper är tre läsningar
 * av samma text, och de gör olika fel — beställarens Colorama-kvitto lästes en gång
 * med butiksnamnet i behåll och två gånger utan, eftersom kameran råkat kapa huvudet.
 * Var för sig är två av dem ofärdiga. Tillsammans är de ett helt kvitto.
 *
 * Regeln är samstämmighet, precis som M6 redan använder för datum inom ett kvitto —
 * här utsträckt från flera segment till flera kvitton. Ett värde två läsningar är
 * överens om väger tyngre än ett som bara en såg, även om den enda var självsäker.
 *
 * **En människas ord väger tyngre än alla maskinens tillsammans.** Har någon skrivit
 * in eller bekräftat ett fält är omröstningen över för det fältet.
 */
import type { Falt, Falten } from "./index.js";

/** Hur mycket varje instämmande läsning lyfter konfidensen. */
const INSTAMMANDE = 0.06;

const NAMN = ["store", "date", "total", "currency"] as const;

export function rosta(medlemmar: Falten[]): Falten {
  const ut: Record<string, Falt<unknown>> = {};

  for (const namn of NAMN) {
    const falten = medlemmar.map((m) => m[namn] as Falt<unknown> | undefined).filter((f): f is Falt<unknown> => !!f);
    if (falten.length === 0) continue;

    // Steg ett: en människa. Har någon satt fältet är det fältets värde, punkt.
    const mansklig = falten.find((f) => f.source === "confirmed") ?? falten.find((f) => f.source === "manual");
    if (mansklig) {
      ut[namn] = mansklig;
      continue;
    }

    // Steg två: samstämmighet. Röster vägs med sin konfidens, inte som ett per skalle —
    // en läsning som själv var osäker ska inte kunna rösta ned en som var det inte.
    const rost = new Map<string, { value: unknown; vikt: number; basta: number; antal: number }>();
    for (const f of falten) {
      const nyckel = JSON.stringify(f.value);
      const fanns = rost.get(nyckel) ?? { value: f.value, vikt: 0, basta: 0, antal: 0 };
      fanns.vikt += f.confidence;
      fanns.basta = Math.max(fanns.basta, f.confidence);
      fanns.antal++;
      rost.set(nyckel, fanns);
    }

    const rankade = [...rost.values()].sort((a, b) => b.vikt - a.vikt || b.basta - a.basta);
    const vinnare = rankade[0]!;
    ut[namn] = {
      value: vinnare.value,
      confidence: Math.min(0.97, Math.round((vinnare.basta + (vinnare.antal - 1) * INSTAMMANDE) * 100) / 100),
      source: "ocr",
      ...(rankade.length > 1
        ? { candidates: rankade.slice(1, 4).map((r) => ({ value: r.value, confidence: r.basta })) }
        : {}),
    };
  }

  return ut as Falten;
}
