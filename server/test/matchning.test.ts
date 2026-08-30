import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { utvinn } from "../src/falt/index.js";
import { utvinnIdentitet } from "../src/falt/identitet.js";
import { gruppera, matchar, nyckel } from "../src/falt/matchning.js";

type Kvitto = { fil: string; grupp?: string; text: string };
const { kvitton } = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/kvitton.json"), "utf8"),
) as { kvitton: Kvitto[] };

const FOTAT = "2026-08-28T12:45:00.000Z";

/** Nycklarna byggs precis som arkivet skulle bygga dem: ur texten, utan facit. */
const nycklar = kvitton.map((k) => {
  const f = utvinn(k.text, FOTAT);
  return nyckel(k.fil, utvinnIdentitet(k.text), {
    ...(f.date ? { datum: f.date.value as string } : {}),
    ...(f.total ? { belopp: f.total.value as number } : {}),
  });
});
const av = (fil: string) => nycklar.find((n) => n.id === fil)!;

describe("matchning av kvitton", () => {
  it("hittar precis de dubblettgrupper som finns i högen", () => {
    const facit = new Map<string, string[]>();
    for (const k of kvitton) {
      if (!k.grupp) continue;
      facit.set(k.grupp, [...(facit.get(k.grupp) ?? []), k.fil]);
    }
    const vantade = [...facit.values()].filter((g) => g.length > 1).map((g) => [...g].sort().join(" + "));
    const funna = gruppera(nycklar).map((g) => g.join(" + "));
    expect(funna.sort()).toEqual(vantade.sort());
  });

  it("binder ihop kvittot och kortslippen — två papper, ett köp", () => {
    expect(matchar(av("flugger-722-kvitto"), av("flugger-722-slip"))).toBe("saker");
  });

  /**
   * Tre foton av samma papper. Det tredje läste kvittonumret som `0224360000771` i
   * stället för `0000022446000000771` och har varken kortreferens eller klockslag —
   * det binds ändå in, via slippen som delar referens med det. Det är hela poängen med
   * ett transitivt hölje: kedjan behöver inte gå direkt mellan varje par.
   */
  it("binder ihop tre foton av samma kvitto även när numret lästes fel", () => {
    expect(matchar(av("colorama-90-b"), av("colorama-90-c"))).toBe("saker");
    const gruppen = gruppera(nycklar).find((g) => g.includes("colorama-90-c"));
    expect(gruppen).toEqual(["colorama-90-a", "colorama-90-b", "colorama-90-c"]);
  });

  it("slår aldrig ihop två köp i samma butik samma dag", () => {
    expect(matchar(av("byggmax-219"), av("byggmax-438"))).toBeNull();
    expect(matchar(av("bauhaus-149"), av("bauhaus-356"))).toBeNull();
  });

  it("slår aldrig ihop kvitton med olika belopp, bolag eller dag", () => {
    for (const a of nycklar) {
      for (const b of nycklar) {
        if (a.id === b.id) continue;
        if (matchar(a, b) === null) continue;
        const par = `${a.id} + ${b.id}`;
        if (a.belopp !== undefined && b.belopp !== undefined) expect(a.belopp, par).toBe(b.belopp);
        if (a.orgnr && b.orgnr) expect(a.orgnr, par).toBe(b.orgnr);
        if (a.datum && b.datum) expect(a.datum, par).toBe(b.datum);
      }
    }
  });
});
