/**
 * ULID myntas på klienten och är kvittots identitet hela vägen — katalognamn på
 * disk, idempotensnyckel vid uppladdning, primärnyckel i indexet. Att den skapas
 * här och inte på servern är hela skälet till att ett omtaget anrop efter en tappad
 * uppkoppling träffar samma kvitto i stället för att skapa ett andra.
 *
 * Crockfords base32, 26 tecken: tio tidsstämpel, sexton slump. Tidsstämpeln avgör
 * vilket år och vilken månad kvittot hamnar under på disk, så den myntas när det
 * första fotot tas — inte när kvittot laddas upp.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(time: number = Date.now()): string {
  let out = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (const byte of bytes) out += CROCKFORD[byte % 32];
  return out;
}

export const isUlid = (value: string): boolean => /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value);
