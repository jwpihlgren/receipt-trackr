/**
 * Kategorins färg, på ett ställe — som `belopp.ts` och `datum.ts`.
 *
 * Regeln fanns i två kopior som inte var lika: arkivet läste kategorilistan ur sitt
 * eget svar, analysen ur `kategorier_ordning`. Nu behöver telefonlistan samma färg, och
 * tre kopior av en regel är två för många.
 *
 * **Färgen följer kategorins plats i arkivets ordning, aldrig dess storlek.** En
 * kategori som växer byter inte färg, och ett filter målar inte om de andra — annars
 * går färgen inte att lära sig, och då bär den ingen betydelse.
 */
const OVRIGT = 'Övrigt';

/** Hur många färger paletten har. Fler kategorier än så börjar om. */
const ANTAL = 6;

export function kategorifarg(kategori: string | null | undefined, ordning: readonly string[]): string {
  if (!kategori || kategori === OVRIGT) return 'var(--kategori-ovrig)';
  const plats = ordning.indexOf(kategori);
  return plats < 0 ? 'var(--kategori-ovrig)' : `var(--kategori-${(plats % ANTAL) + 1})`;
}
