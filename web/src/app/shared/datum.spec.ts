import { datum, kortDatum } from './datum';

describe('kortDatum', () => {
  it('utelämnar året när kvittot är från i år', () => {
    expect(kortDatum('2026-08-24', new Date('2026-12-01'))).toBe('24 aug.');
  });

  it('skriver ut året när det inte är i år', () => {
    expect(kortDatum('2025-05-31', new Date('2026-12-01'))).toBe('31 maj 2025');
  });

  /**
   * Telefonraden bär butik, kategori, datum och belopp på samma rad. Ett datum med år
   * kapades i stället för att skrivas, och "24 au…" är varken ett datum eller en
   * upplysning. Kolumnen i arkivet har plats och behåller året.
   */
  it('är kortare än tabellens datum för samma dag', () => {
    const iAr = new Date().toISOString().slice(0, 10);
    expect(kortDatum(iAr).length).toBeLessThan(datum(iAr).length);
  });
});
