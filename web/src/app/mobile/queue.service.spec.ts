import { TestBed } from '@angular/core/testing';
import { QueueService } from './queue.service';
import { allSegments, allReceipts, deleteReceipt, deleteSegment } from './db';
import { ulid } from '../shared/ulid';

const bytes = (fill: number): ArrayBuffer => new Uint8Array([fill, fill, fill]).buffer;

async function tomKon(): Promise<void> {
  for (const s of await allSegments()) await deleteSegment(s.key);
  for (const r of await allReceipts()) await deleteReceipt(r.id);
}

describe('Kön i telefonen', () => {
  let queue: QueueService;
  let fetchSpy: jasmine.Spy;

  beforeEach(async () => {
    await tomKon();
    TestBed.configureTestingModule({});
    queue = TestBed.inject(QueueService);
    fetchSpy = spyOn(window, 'fetch');
  });

  afterEach(async () => {
    queue.stop();
    await tomKon();
  });

  function svar(body: unknown, status = 200): Promise<Response> {
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }

  it('skriver bilden till disk innan något laddas upp', async () => {
    fetchSpy.and.returnValue(new Promise(() => undefined)); // hänger med flit
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(1), 'abc', { autoShutter: false });

    const stored = await allSegments();
    expect(stored).toHaveSize(1);
    expect(stored[0].sha256).toBe('abc');
  });

  it('raderar den lokala kopian först när servern svarat med samma sha256', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(2), 'rätt-summa', {});

    // Servern svarar 200 — men med en annan summa. Det är inte ett kvitto.
    fetchSpy.and.callFake((url: string) =>
      url.includes('/segments/') ? svar({ sha256: 'annan-summa' }) : svar({ id }),
    );
    await queue.drain();
    expect(await allSegments()).toHaveSize(1);

    // Fel summa märker kvittot som fastnat, och kön rör det inte förrän någon säger
    // till: en avvisning som försöks om av en klocka är den tysta loopen igen.
    expect(queue.snapshot().stuck.map((f) => f.id)).toContain(id);

    // Samma summa: nu, och först nu, får bytesen kastas.
    fetchSpy.and.callFake((url: string) =>
      url.includes('/segments/') ? svar({ sha256: 'rätt-summa' }) : svar({ id }),
    );
    await queue.retryStuck();
    expect(await allSegments()).toHaveSize(0);
  });

  it('behåller kvittot i kön tills komplettsignalen gått fram', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(3), 's1', {});
    await queue.completeReceipt(id, 1);

    fetchSpy.and.callFake((url: string) => {
      if (url.includes('/segments/')) return svar({ sha256: 's1' });
      if (url.includes('/complete')) return svar({}, 503); // servern nere just då
      return svar({ id });
    });
    await queue.drain();
    expect(await allReceipts()).toHaveSize(1);

    fetchSpy.and.callFake((url: string) =>
      url.includes('/complete') ? svar({ expectedSegments: 1 }) : svar({ sha256: 's1' }),
    );
    await queue.drain();
    expect(await allReceipts()).toHaveSize(0);
  });

  it('markerar kvittot som fastnat vid 409 i stället för att skriva över ett original', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(4), 's1', {});
    fetchSpy.and.callFake((url: string) =>
      url.includes('/segments/') ? svar({ error: 'conflict' }, 409) : svar({ id }),
    );

    await queue.drain();
    expect(queue.snapshot().stuck.map((f) => f.id)).toContain(id);
    expect(await allSegments()).toHaveSize(1);
  });

  it('fastnar på 415 i stället för att skicka en oläsbar bild i evighet', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(6), 's1', {});
    fetchSpy.and.callFake((url: string) =>
      url.includes('/segments/') ? svar({ error: 'not_an_image' }, 415) : svar({ id }),
    );

    await queue.drain();
    // Utan den här regeln försöker kön om var femtonde sekund för alltid, tyst.
    expect(queue.snapshot().stuck.map((f) => f.id)).toContain(id);
    expect(await allSegments()).toHaveSize(1);
  });

  it('försöker igen vid 500 — en server som stryper sig löser sig själv', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(7), 's1', {});
    fetchSpy.and.callFake((url: string) =>
      url.includes('/segments/') ? svar({ error: 'internal' }, 500) : svar({ id }),
    );

    await queue.drain();
    expect(queue.snapshot().stuck.map((f) => f.id)).not.toContain(id);
    expect(await allSegments()).toHaveSize(1);
  });

  it('märker inte kvittot som fastnat när sessionen gått ut — kvittot är oskyldigt', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(8), 's1', {});
    fetchSpy.and.returnValue(svar({ error: 'unauthorized' }, 401));

    await queue.drain();
    expect(queue.snapshot().stuck).toEqual([]);
    expect(await allSegments()).toHaveSize(1);
  });

  it('släpper fastnat-märkningen när användaren ber om ett nytt försök', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(9), 's1', {});
    fetchSpy.and.callFake((url: string) =>
      url.includes('/segments/') ? svar({ error: 'conflict' }, 409) : svar({ id }),
    );
    await queue.drain();
    expect(queue.snapshot().stuck.map((f) => f.id)).toContain(id);

    fetchSpy.and.callFake((url: string) => (url.includes('/segments/') ? svar({ sha256: 's1' }) : svar({ id })));
    await queue.retryStuck();
    expect(queue.snapshot().stuck).toEqual([]);
    expect(await allSegments()).toHaveSize(0);
  });

  it('försöker inte om ett avvisat kvitto av sig självt — det är en tyst loop', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(10), 's1', {});
    fetchSpy.and.callFake((url: string) =>
      url.includes('/segments/') ? svar({ error: 'not_an_image' }, 415) : svar({ id }),
    );
    await queue.drain();
    expect(queue.snapshot().stuck.map((f) => f.id)).toContain(id);

    // Nästa pass skulle ha lyckats — men kvittot ska inte skickas förrän en människa
    // sagt till. Utan det här gick anropet var femtonde sekund, för alltid, osynligt.
    fetchSpy.calls.reset();
    fetchSpy.and.callFake((url: string) => (url.includes('/segments/') ? svar({ sha256: 's1' }) : svar({ id })));
    await queue.drain();
    expect(fetchSpy.calls.count()).toBe(0);
    expect(await allSegments()).toHaveSize(1);
  });

  it('släpper inte en 415 vid "Försök igen" — samma bild ger samma svar', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(11), 's1', {});
    fetchSpy.and.callFake((url: string) =>
      url.includes('/segments/') ? svar({ error: 'not_an_image' }, 415) : svar({ id }),
    );
    await queue.drain();
    expect(queue.snapshot().stuck.map((f) => f.gorOm)).toEqual([false]);

    fetchSpy.calls.reset();
    await queue.retryStuck();
    // Knappen ska inte ens vara framme, och trycks den ändå händer ingenting: det såg
    // förut ut som en knapp som inte gjorde något, eftersom raden märktes om direkt.
    expect(fetchSpy.calls.count()).toBe(0);
    expect(queue.snapshot().stuck.map((f) => f.id)).toContain(id);
  });

  it('kastar kvittot på användarens ord: bytesen raderas och servern får en radering', async () => {
    const id = ulid();
    // Nätet ligger nere, så bilden hinner aldrig upp: det är läget knappen finns för.
    fetchSpy.and.returnValue(Promise.reject(new TypeError('Failed to fetch')));
    await queue.enqueueSegment(id, 1, bytes(12), 's1', {});
    await queue.drain();
    expect(await allSegments()).toHaveSize(1);

    fetchSpy.and.callFake(() => svar({}));
    await queue.discardReceipt(id);
    await queue.drain(); // kedjan ut, så att serverraderingen hunnit gå

    expect(await allSegments()).toHaveSize(0);
    expect(await allReceipts()).toHaveSize(0);
    const raderingar = fetchSpy.calls
      .allArgs()
      .filter((args) => (args[1] as RequestInit | undefined)?.method === 'DELETE' && String(args[0]).endsWith(id));
    expect(raderingar).toHaveSize(1);
  });

  it('rör inte kön när nätverket fallerar', async () => {
    const id = ulid();
    await queue.enqueueSegment(id, 1, bytes(5), 's1', {});
    fetchSpy.and.returnValue(Promise.reject(new TypeError('Failed to fetch')));

    await queue.drain();
    expect(await allSegments()).toHaveSize(1);
    expect(await allReceipts()).toHaveSize(1);
  });
});
