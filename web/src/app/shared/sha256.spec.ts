import { sha256, sha256Fallback } from './sha256';

/**
 * Summan är beviskedjan: den lokala kopian raderas först när servern svarat med samma
 * sträng. Två vägar räknar den — webbläsarens inbyggda och vår egen — och om de kan ge
 * olika svar är beviset värdelöst. Därför jämförs de mot varandra, och mot kända
 * summor ur FIPS 180-4.
 */
describe('sha256', () => {
  const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

  it('ger de kända summorna ur standarden', () => {
    expect(sha256Fallback(new ArrayBuffer(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Fallback(bytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Fallback(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('ger samma svar som webbläsarens inbyggda, även över blockgränsen', async () => {
    // 55, 56 och 64 byte är precis där utfyllnaden byter beteende — ett extra block
    // krävs när längden inte får plats tillsammans med längdfältet.
    for (const längd of [0, 1, 55, 56, 63, 64, 65, 1000]) {
      const data = new Uint8Array(längd).map((_, i) => (i * 31) % 256);
      expect(sha256Fallback(data.buffer as ArrayBuffer)).toBe(await sha256(data.buffer as ArrayBuffer));
    }
  });

  it('klarar bytes med högsta biten satt', async () => {
    const data = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0xfe]);
    expect(sha256Fallback(data.buffer as ArrayBuffer)).toBe(await sha256(data.buffer as ArrayBuffer));
  });

  it('räknar på svenska tecken som bytes, inte som kodpunkter', async () => {
    const data = bytes('kanelbullé på Coop Konsum å ä ö');
    expect(sha256Fallback(data)).toBe(await sha256(data));
  });
});
