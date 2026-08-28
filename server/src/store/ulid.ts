/**
 * ULID:en genereras på klienten och är kvittots identitet hela vägen: katalognamn,
 * idempotensnyckel vid uppladdning och primärnyckel i indexet. Servern hittar aldrig
 * på en egen — då skulle ett omtaget nätverksanrop bli ett andra kvitto.
 *
 * Formatet är Crockfords base32, 26 tecken, där de tio första är tidsstämpeln. Det
 * gör den sorterbar i fångstordning, vilket är precis den ordning arkivet vill ha.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

/** Bara för tester och utveckling — i drift kommer ULID:en alltid från klienten. */
export function ulid(time: number = Date.now()): string {
  let out = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32]! + out;
    t = Math.floor(t / 32);
  }
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(Math.random() * 32)]!;
  return out;
}

/** Millisekunderna ur en ULID — används för att lägga kvittot i rätt år och månad. */
export function ulidTime(id: string): number {
  let t = 0;
  for (const c of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(c);
  return t;
}
