import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PassComponent } from './pass.component';

const RAD = {
  id: 'A',
  capturedAt: '2026-08-29T10:00:00.000Z',
  store: 'Coop',
  date: '2026-08-29',
  total: 284.5,
  currency: 'SEK',
  unreviewed: 2,
};

/** Butik och belopp är maskinlästa, datumet har någon redan bekräftat. */
const KVITTO = {
  id: 'A',
  capturedAt: '2026-08-29T10:00:00.000Z',
  segments: [{ file: 'segment-01.jpg', sha256: 'abc' }],
  fields: {
    store: { value: 'Coop', confidence: 0.94, source: 'ocr' },
    date: { value: '2026-08-29', confidence: 0.61, source: 'confirmed' },
    total: { value: 284.5, confidence: 0.93, source: 'ocr' },
  },
  text: 'COOP KONSUM',
};

type Skickat = { url: string; body: { rattelser: { namn: string; value: unknown; bekraftat: boolean }[] } };

describe('Rättningspasset', () => {
  let skickat: Skickat[];

  beforeEach(async () => {
    skickat = [];
    spyOn(globalThis, 'fetch').and.callFake(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/pass')) return svar({ total: 1, receipts: [RAD] });
      if (url.endsWith('/falt/flera')) {
        skickat.push({ url, body: JSON.parse(String(init?.body)) as Skickat['body'] });
        return svar(KVITTO);
      }
      return svar(KVITTO);
    });

    await TestBed.configureTestingModule({
      imports: [PassComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  const svar = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  /** Låter hämtningarna hinna fram: passet gör två i rad innan det står still. */
  const tick = async (varv = 10): Promise<void> => {
    for (let i = 0; i < varv; i++) await new Promise((r) => setTimeout(r, 0));
  };

  async function passet(): Promise<PassComponent> {
    const fixture = TestBed.createComponent(PassComponent);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('hämtar arbetslistan och tar in det första kvittot', async () => {
    const pass = await passet();
    expect(pass.antal()).toBe(1);
    expect(pass.receipt()?.id).toBe('A');
    // Utkasten är det maskinen läste, med belopp skrivet som man skriver det.
    expect(pass.utkast()['total']).toBe('284,5');
  });

  /**
   * Hela mätvärdet ligger i den här skillnaden: ett ändrat fält är en rättelse, ett
   * orört maskinläst är en bekräftelse ("maskinen hade rätt vid 0,93"), och ett fält
   * någon redan granskat skickas inte alls — en andra bekräftelse vore samma blick
   * räknad två gånger.
   */
  it('skiljer på rättelse, bekräftelse och det som redan är granskat', async () => {
    const pass = await passet();
    pass.onUtkast('store', { target: { value: 'Coop Kungsholmen' } } as unknown as Event);
    pass.sparaOchNasta();
    await tick();

    expect(skickat).toHaveSize(1);
    expect(skickat[0]!.body.rattelser).toEqual([
      { namn: 'store', value: 'Coop Kungsholmen', bekraftat: false },
      { namn: 'total', value: 284.5, bekraftat: true },
    ]);
  });

  it('läser beloppet med komma som ett tal, och lämnar ett tomt fält i fred', async () => {
    const pass = await passet();
    pass.onUtkast('total', { target: { value: '1 ' } } as unknown as Event);
    pass.onUtkast('store', { target: { value: '  ' } } as unknown as Event);
    pass.onUtkast('total', { target: { value: '4219,00' } } as unknown as Event);
    pass.sparaOchNasta();
    await tick();

    expect(skickat[0]!.body.rattelser).toEqual([{ namn: 'total', value: 4219, bekraftat: false }]);
  });

  it('är slut när kön är genomgången', async () => {
    const pass = await passet();
    pass.hoppaOver();
    await tick();
    expect(pass.klart()).toBe(true);
    // Ett överhoppat kvitto är inte granskat och ska inte räknas som det.
    expect(pass.klara().size).toBe(0);
  });
});
