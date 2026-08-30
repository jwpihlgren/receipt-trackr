import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { luhn, utvinnIdentitet } from "../src/falt/identitet.js";

type Kvitto = { fil: string; grupp?: string; text: string };
const { kvitton } = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/kvitton.json"), "utf8"),
) as { kvitton: Kvitto[] };

const av = (fil: string) => utvinnIdentitet(kvitton.find((k) => k.fil === fil)!.text);

describe("kvittots identitet", () => {
  it("räknar Luhn på organisationsnummer", () => {
    expect(luhn("5566456215")).toBe(true);   // Byggmax
    expect(luhn("5560599473")).toBe(true);   // Systembolaget
    expect(luhn("5566456216")).toBe(false);  // en siffra fel
    expect(luhn("556645621")).toBe(false);   // för kort
  });

  it("läser organisationsnumret i alla former som står på kvittona", () => {
    expect(av("byggmax-438").orgnr).toBe("556645-6215");        // Org.nr: 556645-6215
    expect(av("systembolaget-1369").orgnr).toBe("556059-9473"); // 0rgNr:556059-9473
    expect(av("colorama-90-a").orgnr).toBe("556094-3267");      // Moms RegNr: SE556094326701
    expect(av("biltema-548").orgnr).toBe("556297-3320");        // ORGANISATIONSNR:
    expect(av("dackskiftarna-adress").orgnr).toBe("559269-2247"); // bart, utan ord före
  });

  it("läser kvittonummer, tid och kortreferens", () => {
    const b = av("byggmax-2033-a");
    expect(b.kvittonummer).toBe("CO1213-00342257");
    expect(b.tid).toBe("07:31");
    const c = av("colorama-90-b");
    expect(c.kortref).toContain("171723000475");
  });

  /** Poängen med alltihop: samma köp ska ha samma ankare, olika köp olika. */
  it("ger samma ankare åt alla foton av samma kvitto", () => {
    const grupper = new Map<string, Kvitto[]>();
    for (const k of kvitton) if (k.grupp) grupper.set(k.grupp, [...(grupper.get(k.grupp) ?? []), k]);

    for (const [namn, medlemmar] of grupper) {
      if (medlemmar.length < 2) continue;
      const identiteter = medlemmar.map((m) => utvinnIdentitet(m.text));
      // Minst ett ankare måste vara gemensamt för hela gruppen.
      const orgnr = new Set(identiteter.map((i) => i.orgnr).filter(Boolean));
      const refs = identiteter.map((i) => new Set(i.kortref ?? []));
      const gemensamRef = refs.every((r) => r.size > 0) &&
        [...refs[0]!].some((r) => refs.every((annan) => annan.has(r)));
      expect(orgnr.size <= 1 || gemensamRef, `${namn}: ${JSON.stringify(identiteter)}`).toBe(true);
    }
  });

  it("ger olika kvittonummer åt två köp i samma butik samma dag", () => {
    expect(av("byggmax-219").kvittonummer).not.toBe(av("byggmax-438").kvittonummer);
  });
});
