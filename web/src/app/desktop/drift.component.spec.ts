import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DriftComponent, type Health } from './drift.component';

const HEALTH: Health = {
  status: 'ok',
  version: '0.0.0',
  uptimeSeconds: 12,
  data: {
    path: '/data',
    mount: '/data',
    filesystem: 'zfs',
    free: '412 GiB',
    total: '1.8 TiB',
    minFree: '5.0 GiB',
    belowFloor: false,
  },
  backupDir: '/backup',
};

describe('Driftvyn', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriftComponent],
      // Vyn länkar tillbaka till arkivet sedan skrivbordet fick fler ytor än en.
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('visar var arkivet ligger och hur mycket som är kvar', () => {
    const fixture = TestBed.createComponent(DriftComponent);
    fixture.detectChanges();
    http.expectOne('/api/health').flush(HEALTH);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Arkivet mår bra');
    expect(text).toContain('/data');
    expect(text).toContain('412 GiB');
  });

  it('visar 503-svaret i stället för att svälja det — det är läget vyn finns för', () => {
    const fixture = TestBed.createComponent(DriftComponent);
    fixture.detectChanges();
    const degraded: Health = { ...HEALTH, status: 'degraded', data: { ...HEALTH.data, belowFloor: true } };
    http.expectOne('/api/health').flush(degraded, { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('För lite utrymme kvar');
  });
});
