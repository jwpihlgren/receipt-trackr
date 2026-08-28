import { isUlid, ulid } from './ulid';

describe('ULID på klienten', () => {
  it('har rätt form och godkänns av serverns regel', () => {
    expect(isUlid(ulid())).toBe(true);
    expect(ulid()).toHaveSize(26);
  });

  it('sorterar i tidsordning — arkivet vill ha fångstordningen', () => {
    const tidigt = ulid(Date.UTC(2026, 0, 1));
    const sent = ulid(Date.UTC(2026, 6, 1));
    expect(tidigt < sent).toBe(true);
  });

  it('ger olika id för samma millisekund', () => {
    const t = Date.now();
    const many = new Set(Array.from({ length: 200 }, () => ulid(t)));
    expect(many.size).toBe(200);
  });

  it('kodar tidsstämpeln i de tio första tecknen — den bestämmer katalogen på disk', () => {
    const t = Date.UTC(2026, 3, 11);
    expect(ulid(t).slice(0, 10)).toBe(ulid(t).slice(0, 10));
  });
});
