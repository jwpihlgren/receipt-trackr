import { Injectable, computed, inject, signal } from '@angular/core';
import { OcrService } from './ocr.service';

type Jobb = {
  id: string;
  capturedAt: string;
  segments: { index: number; file: string; sha256: string; rotation?: 0 | 90 | 180 | 270 }[];
  reservationTill: number;
  uppratt: boolean;
};

export type TolkningsLage = {
  vantande: number;
  /** Hur många av de väntande som redan är utdelade till någon enhet. */
  reserverade: number;
  /** Slagen av enheter som arbetar just nu: `telefon`, `dator`, `okand`. */
  enheter: string[];
  kor: boolean;
  aktuellt: string | null;
  steg: string | null;
  klaraIPasset: number;
  /** Hur många kvitton passet omfattade när det började. Noll när inget pass körs. */
  iPasset: number;
  /**
   * Räknare som bara går uppåt, över hela sessionen. Vyer lyssnar på den för att veta
   * när de ska hämta om sin lista — utan den tolkar appen vidare medan raderna står
   * kvar och säger "inte tolkat än", och det ser ut som att ingenting händer.
   * `klaraIPasset` duger inte till det: den nollställs vid varje nytt pass.
   */
  klaraTotalt: number;
  fel: string | null;
};

const ARBETARE_NYCKEL = 'receipt-trackr:arbetare';

/**
 * Tolkningen, sedd från klienten.
 *
 * Tjänsten startar aldrig något själv. Den har två ingångar — `kor()` som betar av
 * kön en gång, och `startaLopande()` som fortsätter så länge appen är öppen — och
 * vilken som används avgörs på ytan. Telefonen kör löpande, för det var hela poängen
 * med att fånga och tolka på samma enhet. Datorn kör bara `kor()`, och bara när någon
 * trycker på knappen där: beställaren har varit uttrycklig med att hans dator får
 * arbeta när han från den datorn tar emot ett jobb, aldrig annars.
 *
 * Den regeln bor här, i klienten, och kan inte flyttas till servern — servern räknar
 * inte.
 */
@Injectable({ providedIn: 'root' })
export class TolkningService {
  private readonly ocr = inject(OcrService);

  private readonly lage = signal<TolkningsLage>({
    vantande: 0,
    reserverade: 0,
    enheter: [],
    kor: false,
    aktuellt: null,
    steg: null,
    klaraIPasset: 0,
    iPasset: 0,
    klaraTotalt: 0,
    fel: null,
  });

  readonly snapshot = this.lage.asReadonly();
  readonly vantande = computed(() => this.lage().vantande);
  /** Signalen vyerna hänger sina omhämtningar på. */
  readonly klaraTotalt = computed(() => this.lage().klaraTotalt);
  /**
   * Kvittot som läses just nu. Egen signal, inte `snapshot().aktuellt`: den som vill
   * veta när tolkningen gått vidare till nästa kvitto ska inte väckas av varje
   * bildsteg inuti ett kvitto.
   */
  readonly aktuellt = computed(() => this.lage().aktuellt);

  /**
   * Kvitton som väntar och som **ingen** redan läser. Det är den enda siffran en knapp
   * får bygga på: kön minus det som är utdelat.
   */
  readonly lediga = computed(() => Math.max(0, this.lage().vantande - this.lage().reserverade));

  /**
   * Vem som läser, i klartext — eller `null` när ingen gör det.
   *
   * Aktiviteten sa "Väntar på tolkning" med en knapp bredvid medan telefonen läste
   * samma kvitton. Skärmen bad om ett handgrepp för ett arbete som redan pågick, och
   * det är precis den sortens uppmaning appen inte ska ge.
   */
  readonly nagonLaser = computed(() => {
    const l = this.lage();
    if (l.reserverade === 0) return null;
    const antal = `${l.reserverade} ${l.reserverade === 1 ? 'kvitto' : 'kvitton'}`;
    return `${enhetsord(l.enheter)} läser ${antal}`;
  });

  /**
   * Vad som läses just nu, i klartext — på ett ställe, för både importen och
   * aktiviteten säger samma sak.
   *
   * "Läser bild 1 av 1" beskrev steget inuti ett kvitto och såg därför ut som att bara
   * ett kvitto skulle läsas. Räkningen gäller passet: kvitto två av sju, med bildsteget
   * som understycke när kvittot har flera bilder.
   */
  readonly laser = computed(() => {
    const l = this.lage();
    if (!l.kor) return null;
    const av = l.iPasset;
    const nr = Math.min(l.klaraIPasset + 1, Math.max(av, 1));
    const kvittot = av > 1 ? `Läser kvitto ${nr} av ${av}` : 'Läser kvittot';
    return l.steg ? `${kvittot} · ${l.steg}` : kvittot;
  });

  private lopande = false;
  private stoppa = false;

  /** En stabil identitet per enhet, så att serverns reservationer kan skiljas åt. */
  private readonly arbetare = ((): string => {
    try {
      const fanns = localStorage.getItem(ARBETARE_NYCKEL);
      if (fanns) return fanns;
      const ny = `${navigator.userAgent.includes('Mobile') ? 'telefon' : 'dator'}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(ARBETARE_NYCKEL, ny);
      return ny;
    } catch {
      return `okand-${Math.random().toString(36).slice(2, 8)}`;
    }
  })();

  async rakna(): Promise<number> {
    try {
      const svar = await fetch('/api/jobb');
      if (!svar.ok) return this.lage().vantande;
      const body = (await svar.json()) as { vantande: number; reserverade?: number; enheter?: string[] };
      this.lage.update((l) => ({
        ...l,
        vantande: body.vantande,
        reserverade: body.reserverade ?? 0,
        enheter: body.enheter ?? [],
      }));
      return body.vantande;
    } catch {
      return this.lage().vantande;
    }
  }

  /** Betar av kön tills den är tom eller någon säger stopp. */
  async kor(): Promise<void> {
    if (this.lage().kor) return;
    this.stoppa = false;
    // Passets storlek fryses här: "läser 2 av 7" ska räkna det man startade, inte en
    // kö som krymper medan man tittar på den.
    const totalt = await this.rakna();
    this.lage.update((l) => ({ ...l, kor: true, fel: null, klaraIPasset: 0, iPasset: totalt }));
    try {
      this.lage.update((l) => ({ ...l, steg: 'Laddar modellen …' }));
      await this.ocr.varm('tiny');

      while (!this.stoppa) {
        const jobb = await this.hamta();
        if (jobb.length === 0) break;
        for (const j of jobb) {
          if (this.stoppa) {
            await this.aterlamna(j.id);
            break;
          }
          await this.tolkaEtt(j);
        }
      }
    } catch (fel) {
      this.lage.update((l) => ({ ...l, fel: (fel instanceof Error ? fel.message : String(fel)) }));
    } finally {
      this.lage.update((l) => ({ ...l, kor: false, aktuellt: null, steg: null, iPasset: 0 }));
      await this.rakna();
    }
  }

  /**
   * Tolkar ett bestämt kvitto direkt.
   *
   * *Läs om bilden* la tidigare tillbaka kvittot i kön och lämnade användaren att
   * trycka *Tolka här* — två steg av en handling, och det andra steget syntes inte.
   * Nu läser den här webbläsaren om bilden på fläcken.
   */
  async koraEtt(id: string): Promise<void> {
    if (this.lage().kor) return;
    this.stoppa = false;
    this.lage.update((l) => ({ ...l, kor: true, fel: null, klaraIPasset: 0, iPasset: 1, aktuellt: id }));
    try {
      const jobb = await this.hamta(id);
      const mitt = jobb.find((j) => j.id === id);
      if (!mitt) throw new Error('Kvittot var inte ledigt för tolkning.');
      await this.tolkaEtt(mitt);
    } catch (fel) {
      this.lage.update((l) => ({ ...l, fel: (fel instanceof Error ? fel.message : String(fel)) }));
    } finally {
      this.lage.update((l) => ({ ...l, kor: false, aktuellt: null, steg: null, iPasset: 0 }));
      await this.rakna();
    }
  }

  /** Stannar efter det kvitto som pågår. Ett halvtolkat kvitto lämnas aldrig. */
  stanna(): void {
    this.stoppa = true;
  }

  /**
   * Telefonens läge: fortsätt så länge appen är öppen och synlig. Pausar när fliken
   * går i bakgrunden — en telefon som ligger i fickan ska inte bränna batteri på
   * inferens, och reservationen går ändå ut och blir ledig igen.
   */
  private pulslyssnare: (() => void) | null = null;
  private pulstimer: ReturnType<typeof setInterval> | null = null;

  startaLopande(): void {
    if (this.lopande) return;
    this.lopande = true;

    const puls = async (): Promise<void> => {
      if (!this.lopande) return;
      if (document.visibilityState === 'visible' && !this.lage().kor) {
        if ((await this.rakna()) > 0) await this.kor();
      }
    };

    this.pulslyssnare = () => void puls();
    document.addEventListener('visibilitychange', this.pulslyssnare);
    this.pulstimer = setInterval(() => void puls(), 30_000);
    void puls();
  }

  /**
   * Lyssnaren och timern tas bort, inte bara flaggan. Tjänsten lever i roten och
   * överlever ytbytet; utan det här låg en pulsslyssnare och en trettiosekunderstimer
   * kvar i datorläget och startade tolkningen av sig själv.
   */
  stoppaLopande(): void {
    this.lopande = false;
    if (this.pulslyssnare) document.removeEventListener('visibilitychange', this.pulslyssnare);
    this.pulslyssnare = null;
    if (this.pulstimer) clearInterval(this.pulstimer);
    this.pulstimer = null;
    this.stanna();
  }

  private async hamta(id?: string): Promise<Jobb[]> {
    const svar = await fetch('/api/jobb/hamta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arbetare: this.arbetare, antal: 1, ...(id ? { id } : {}) }),
    });
    if (!svar.ok) return [];
    return ((await svar.json()) as { jobb: Jobb[] }).jobb;
  }

  private async aterlamna(id: string): Promise<void> {
    await fetch(`/api/jobb/${id}?arbetare=${encodeURIComponent(this.arbetare)}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
  }

  private async tolkaEtt(jobb: Jobb): Promise<void> {
    this.lage.update((l) => ({ ...l, aktuellt: jobb.id }));
    const delar: string[] = [];
    const rader: { text: string; confidence: number }[] = [];
    let msTotalt = 0;

    try {
      for (const segment of jobb.segments) {
        this.lage.update((l) => ({
          ...l,
          steg: `Läser bild ${segment.index} av ${jobb.segments.length}`,
        }));
        const bild = await fetch(`/api/receipts/${jobb.id}/files/${segment.file}`);
        if (!bild.ok) throw new Error(`bild ${segment.file}: ${bild.status}`);
        /**
         * Har en människa vridit bilden gäller det. Hon har sett papperet; gissningen
         * har bara sett pixlar, kostar 500–700 ms och hade fel på en bild av trettiofem
         * i M0. Egna fångster står redan upp — då sparas uppräteningen in helt (M5a).
         */
        const rotation = segment.rotation ?? (jobb.uppratt ? 0 : 'auto');
        const utfall = await this.ocr.tolka(await bild.arrayBuffer(), 'tiny', rotation);
        delar.push(utfall.text);
        rader.push(...utfall.rader);
        msTotalt += utfall.ms.totalt;
      }

      const konfidenser = rader.map((r) => r.confidence).sort((a, b) => a - b);
      const tecken = delar.join('\n').length;

      const svar = await fetch(`/api/jobb/${jobb.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: delar.join('\n'),
          ocr: {
            motor: 'ppu-paddle-ocr/web',
            niva: 'tiny',
            arbetare: this.arbetare,
            vid: new Date().toISOString(),
            ms: msTotalt,
            rader,
            // Måtten M0 krävde skulle synas: en bild som lästes tecken för tecken får
            // inte se ut som ett färdigt kvitto med tomma fält.
            teckenPerRad: rader.length ? Math.round((tecken / rader.length) * 100) / 100 : 0,
            median: kvantil(konfidenser, 0.5),
            p10: kvantil(konfidenser, 0.1),
          },
        }),
      });
      // Utan den här kontrollen räknades kvittot som klart även när servern sagt nej,
      // och räknaren påstod att arbete blivit gjort som inte blivit det.
      if (svar.status === 401) throw new Error('sessionen har gått ut — logga in igen');
      if (!svar.ok) throw new Error(`servern tog inte emot tolkningen (${svar.status})`);

      this.lage.update((l) => ({
        ...l,
        klaraIPasset: l.klaraIPasset + 1,
        klaraTotalt: l.klaraTotalt + 1,
        vantande: Math.max(0, l.vantande - 1),
      }));
    } catch (fel) {
      // Jobbet lämnas tillbaka så att någon annan — eller samma enhet senare — kan ta
      // det. Utan det ligger kvittot reserverat i fem minuter för ingenting.
      await this.aterlamna(jobb.id);
      // Felet ska säga vad man gör åt det, inte bara vilket ULID och vilken
      // statuskod det gällde. Kastas något som inte är ett Error blev meddelandet
      // dessutom "undefined".
      const varfor = fel instanceof Error ? fel.message : String(fel);
      this.lage.update((l) => ({ ...l, fel: `Ett kvitto kunde inte tolkas: ${varfor}` }));
    }
  }
}

/**
 * Vem som arbetar, sett från den här skärmen. Slaget kommer ur arbetarnamnet, som
 * telefonen och datorn sätter själva — servern håller inget register över apparater.
 */
function enhetsord(enheter: string[]): string {
  if (enheter.length > 1) return 'Flera enheter';
  switch (enheter[0]) {
    case 'telefon':
      return 'Telefonen';
    case 'dator':
      return 'En dator';
    default:
      return 'En annan enhet';
  }
}

function kvantil(sorterad: number[], p: number): number {
  if (sorterad.length === 0) return 0;
  const i = (sorterad.length - 1) * p;
  const lag = Math.floor(i);
  const hog = Math.ceil(i);
  const v = lag === hog ? sorterad[lag]! : sorterad[lag]! + (i - lag) * (sorterad[hog]! - sorterad[lag]!);
  return Math.round(v * 1000) / 1000;
}
