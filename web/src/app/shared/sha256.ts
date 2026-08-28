/**
 * Summan räknas på klienten på exakt de bytes som skickas, och jämförs mot serverns
 * svar innan den lokala kopian raderas. Det är den regeln som gör att en bild inte
 * kan försvinna tyst: ett HTTP-svar med 200 räcker inte som bevis på att rätt bytes
 * kom fram.
 *
 * `crypto.subtle` kräver säker kontext. Över tailnet med TLS är den uppfylld;
 * på `http://localhost` likaså.
 */
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!crypto.subtle) {
    throw new Error('Kryptobiblioteket saknas — sidan måste öppnas över https eller localhost.');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
