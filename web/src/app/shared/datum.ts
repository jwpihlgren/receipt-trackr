/**
 * Datum och tid, formaterade på ett ställe.
 *
 * Fem komponenter formaterade själva, i tre format som inte var beslutade utan
 * blev till: `toLocaleDateString` här, `toLocaleString` där, en egen ULID-avkodning
 * i kön. Samma kvitto kunde stå som "30 aug. 2026" i arkivet och "30 aug. 21:40" i
 * aktiviteten utan att någon valt det.
 *
 * Fyra former, en per fråga:
 *   datum()      — vilken dag var det? Kolumn i en tabell, där året spelar roll.
 *   tidpunkt()   — när exakt? Rad i en kö eller i aktiviteten, där dagen är nära.
 *   tid()        — klockslag ensamt, för en lista som redan har dagen som rubrik.
 *   dagrubrik()  — rubriken över en sådan grupp.
 *
 * Allt är sv-SE. Appen har ett språk och kommer inte att få fler.
 */

const SPRAK = 'sv-SE';

/** "30 aug. 2026" — dagen, med året, som ett datum i en kolumn. */
export function datum(iso: string): string {
  return new Date(iso).toLocaleDateString(SPRAK, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * "I dag 21:40" eller "30 aug. 21:40" — när något hände, sett från nu.
 *
 * Året står inte här med flit: det som visas med klockslag är alltid färskt, och
 * "2026" i varje rad i en kö är brus.
 */
export function tidpunkt(varde: string | number | Date): string {
  const d = new Date(varde);
  const klocka = tidUr(d);
  return idag(d) ? `I dag ${klocka}` : `${d.toLocaleDateString(SPRAK, { day: 'numeric', month: 'short' })} ${klocka}`;
}

/** "21:40" — klockslaget ensamt, när dagen redan står som rubrik ovanför. */
export function tid(iso: string): string {
  return tidUr(new Date(iso));
}

/** "I DAG", "I GÅR" eller "30 AUGUSTI" — rubriken över en dagsgrupp. */
export function dagrubrik(iso: string): string {
  const d = new Date(iso);
  if (idag(d)) return 'I DAG';
  const igar = new Date();
  igar.setDate(igar.getDate() - 1);
  if (d.toDateString() === igar.toDateString()) return 'I GÅR';
  return d.toLocaleDateString(SPRAK, { day: 'numeric', month: 'long' }).toUpperCase();
}

/**
 * Tidpunkten ur ett ULID. De första 48 bitarna är millisekunder sedan epoken, så
 * ett kvitto som ännu inte nått servern har ändå en tid — den ligger i id:t.
 */
export function tidpunktUrUlid(id: string): string {
  const ALFABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let ms = 0;
  for (const tecken of id.slice(0, 10)) {
    const varde = ALFABET.indexOf(tecken);
    if (varde < 0) return '';
    ms = ms * 32 + varde;
  }
  return tidpunkt(ms);
}

const tidUr = (d: Date): string => d.toLocaleTimeString(SPRAK, { hour: '2-digit', minute: '2-digit' });
const idag = (d: Date): boolean => d.toDateString() === new Date().toDateString();
