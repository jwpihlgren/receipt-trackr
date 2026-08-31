/**
 * Ett sätt att skriva ett belopp, som `datum.ts` är ett sätt att skriva en tidpunkt.
 *
 * Regeln fanns redan, men bara i skrivbordets huvud: svenska tal, mellanrum mellan
 * tusentalen, alltid två decimaler. Arkivet, analysen och kvittovyn skrev var sin
 * kopia av samma rad, och telefonlistan skrev talet rakt av — `1092.25 kr` i handen
 * mot `1 092,25 kr` på skärmen, för samma kvitto. Det är den sortens skillnad som får
 * en att kontrollräkna i onödan.
 */
const SPRAK = 'sv-SE';

/** `1092.25` → `1 092,25`. `null` blir ett tankstreck, aldrig en tom cell. */
export function belopp(varde: number | null | undefined): string {
  if (varde === null || varde === undefined) return '—';
  return varde.toLocaleString(SPRAK, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Heltal utan ören: för etiketter som ska läsas i ögonvrån, inte räknas. */
export function heltBelopp(varde: number): string {
  return Math.round(varde).toLocaleString(SPRAK);
}
