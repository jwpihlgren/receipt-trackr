import { Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';

export type VisadBild = {
  /** Filnamnet i arkivet, `segment-01.jpg`. */
  file: string;
  /** Fångsten bilden ligger i. Ett kvitto kan bestå av flera. */
  kvitto: string;
  index: number;
  url: string;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
};

/** Zoomsteg. `anpassa` är hela bilden i rutan; resten är faktorer mot bildens egna pixlar. */
const STEG = [0.5, 1, 2, 4] as const;

/**
 * Bilden över hela ytan: zoom, vridning och vägen till originalfilen.
 *
 * Kvittovyn visar bilden 448 px bred, vilket räcker för att se *vilket* kvitto det är
 * men inte för att läsa en rad som tolkningen läste fel. Den som ska rätta ett belopp
 * måste kunna se siffran, och en bild som ligger ned måste gå att vrida.
 *
 * **Vridningen är inte en visning.** Den lämnas vidare till kvittovyn, som sparar den
 * på segmentet — en människas ord om bilden gäller överallt: i listan, i tumnageln och
 * i nästa tolkning. Originalfilens bytes rörs aldrig; de är arkivets sanning.
 */
@Component({
  selector: 'app-bildvisare',
  templateUrl: './bildvisare.component.html',
})
export class BildvisareComponent {
  readonly bilder = input.required<VisadBild[]>();
  /** Vilken bild som visas när visaren öppnas. Index i `bilder`, inte segmentnummer. */
  readonly start = input(0);

  readonly stang = output<void>();
  readonly vrid = output<{ index: number; rotation: 0 | 90 | 180 | 270 }>();

  private readonly rutan = viewChild<ElementRef<HTMLDialogElement>>('rutan');
  private readonly ytan = viewChild<ElementRef<HTMLElement>>('ytan');

  readonly nuvarande = signal(0);
  /** `null` betyder anpassad till rutan; ett tal är faktorn mot bildens egna pixlar. */
  readonly skala = signal<number | null>(null);
  private readonly ytstorlek = signal({ bredd: 0, hojd: 0 });

  readonly bild = computed(() => this.bilder()[this.nuvarande()] ?? null);

  /** Bildens mått som de ser ut på skärmen: vridning på 90° byter bredd mot höjd. */
  private readonly visadeMatt = computed(() => {
    const bild = this.bild();
    if (!bild) return { bredd: 0, hojd: 0 };
    const pastaende = bild.rotation % 180 === 90;
    return { bredd: pastaende ? bild.height : bild.width, hojd: pastaende ? bild.width : bild.height };
  });

  /** Faktorn som får hela bilden att rymmas. Räknas ur ytan, inte gissad. */
  private readonly anpassad = computed(() => {
    const { bredd, hojd } = this.visadeMatt();
    const yta = this.ytstorlek();
    if (!bredd || !hojd || !yta.bredd || !yta.hojd) return 1;
    return Math.min(yta.bredd / bredd, yta.hojd / hojd, 1);
  });

  readonly faktor = computed(() => this.skala() ?? this.anpassad());
  readonly procent = computed(() => Math.round(this.faktor() * 100));

  /** Ramens mått. Den bär bildens plats i flödet; bilden själv vrids inuti den. */
  readonly ram = computed(() => {
    const { bredd, hojd } = this.visadeMatt();
    const f = this.faktor();
    return { bredd: Math.round(bredd * f), hojd: Math.round(hojd * f) };
  });

  readonly bildstorlek = computed(() => {
    const bild = this.bild();
    const f = this.faktor();
    return bild ? { bredd: Math.round(bild.width * f), hojd: Math.round(bild.height * f) } : { bredd: 0, hojd: 0 };
  });

  constructor() {
    effect(() => {
      const el = this.rutan()?.nativeElement;
      if (el && !el.open) el.showModal();
    });
    effect(() => {
      this.nuvarande.set(Math.min(Math.max(this.start(), 0), Math.max(this.bilder().length - 1, 0)));
    });
    // Ytan mäts när den finns och när fönstret ändras: den anpassade skalan är ett
    // förhållande mellan bilden och rutan, och en gissad ruta ger fel förhållande.
    effect((rensa) => {
      const el = this.ytan()?.nativeElement;
      if (!el) return;
      /**
       * Innermåtten, utan paddingen. `clientHeight` räknar in den, och en anpassad
       * bild blev därför några procent för stor: översta raden hamnade under
       * verktygsraden, alltså just den rad man öppnat visaren för att läsa.
       */
      const mat = (): void => {
        const stil = getComputedStyle(el);
        const vagratt = parseFloat(stil.paddingLeft) + parseFloat(stil.paddingRight);
        const lodratt = parseFloat(stil.paddingTop) + parseFloat(stil.paddingBottom);
        this.ytstorlek.set({
          bredd: Math.max(0, el.clientWidth - vagratt),
          hojd: Math.max(0, el.clientHeight - lodratt),
        });
      };
      mat();
      const observator = new ResizeObserver(mat);
      observator.observe(el);
      rensa(() => observator.disconnect());
    });
  }

  stangVisaren(): void {
    this.rutan()?.nativeElement.close();
    this.stang.emit();
  }

  visa(index: number): void {
    this.nuvarande.set(index);
    this.skala.set(null);
  }

  anpassa(): void {
    this.skala.set(null);
  }

  zooma(riktning: 1 | -1): void {
    const nu = this.faktor();
    const steg = riktning === 1 ? STEG.find((s) => s > nu + 0.001) : [...STEG].reverse().find((s) => s < nu - 0.001);
    this.skala.set(steg ?? (riktning === 1 ? STEG[STEG.length - 1]! : STEG[0]!));
  }

  /** Vrider ett kvarts varv. Fyra vridningar är samma bild igen, aldrig fyra filer. */
  vridBilden(steg: 1 | -1): void {
    const bild = this.bild();
    if (!bild) return;
    const rotation = (((bild.rotation + steg * 90) % 360) + 360) % 360;
    this.vrid.emit({ index: bild.index, rotation: rotation as 0 | 90 | 180 | 270 });
  }
}
