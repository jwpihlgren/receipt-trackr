import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { utvinn } from "../src/falt/index.js";
import { utvinnIdentitet } from "../src/falt/identitet.js";
import { gruppera, nyckel } from "../src/falt/matchning.js";
import { rosta } from "../src/falt/rostning.js";

type Kvitto = { fil: string; butik: string | null; datum: string | null; belopp: number | null; text: string };
const { kvitton } = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/kvitton.json"), "utf8"),
) as { kvitton: Kvitto[] };

const FOTAT = "2026-08-28T12:45:00.000Z";
const falten = new Map(kvitton.map((k) => [k.fil, utvinn(k.text, FOTAT)]));
const nycklar = kvitton.map((k) => {
  const f = falten.get(k.fil)!;
  return nyckel(k.fil, utvinnIdentitet(k.text), {
    ...(f.date ? { datum: f.date.value as string } : {}),
    ...(f.total ? { belopp: f.total.value as number } : {}),
  });
});
const grupper = gruppera(nycklar);
const gruppMed = (fil: string) => grupper.find((g) => g.includes(fil))!;
const rostaFram = (fil: string) => rosta(gruppMed(fil).map((id) => falten.get(id)!));

describe("röstning inom en grupp", () => {
  it("fyller butiken från syskonen när ett foto kapat kvittots huvud", () => {
    // Ensam läser colorama-90-b ingen butik alls: den bilden börjar mitt i momsraden.
    expect(falten.get("colorama-90-b")!.store).toBeUndefined();
    expect(rostaFram("colorama-90-b").store?.value).toBe("Colorama");
  });

  it("fyller butiken på Søstrene Grene, där bara ena fotot fick med logotypen", () => {
    expect(falten.get("sostrene-hm-a")!.store).toBeUndefined();
    expect(rostaFram("sostrene-hm-a").store?.value).toBe("Søstrene Grene");
  });

  it("höjer konfidensen när läsningarna är överens", () => {
    const ensam = falten.get("colorama-3474-a")!.store!.confidence;
    const tillsammans = rostaFram("colorama-3474-a").store!.confidence;
    expect(tillsammans, `${ensam} → ${tillsammans}`).toBeGreaterThan(ensam);
  });

  it("ger hela högen rätt fält när grupperna vägts ihop", () => {
    let ratt = 0;
    let av = 0;
    for (const k of kvitton) {
      const gruppen = grupper.find((g) => g.includes(k.fil)) ?? [k.fil];
      const vagt = rosta(gruppen.map((id) => falten.get(id)!));
      for (const [namn, fack] of [["butik", "store"], ["datum", "date"], ["belopp", "total"]] as const) {
        const facit = k[namn];
        if (facit === null) continue;
        av++;
        if ((vagt[fack]?.value ?? null) === facit) ratt++;
      }
    }
    /**
     * Alla fält rätt. Utan röstningen fattas två butiker — de två kvitton vars
     * huvud kameran kapade — och det är precis de luckor grupperna fyller.
     */
    expect(ratt, `${ratt} av ${av}`).toBe(av);
  });

  it("låter en människas ord stå över varje maskinläsning", () => {
    const vagt = rosta([
      { store: { value: "Fel", confidence: 0.95, source: "ocr" } },
      { store: { value: "Fel", confidence: 0.95, source: "ocr" } },
      { store: { value: "Rätt", confidence: 0.3, source: "manual" } },
    ]);
    expect(vagt.store?.value).toBe("Rätt");
  });
});
