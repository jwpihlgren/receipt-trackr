import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ElementRef, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QueueService, type Fastnat } from './queue.service';
import { segmentsFor } from './db';
import { tidpunktUrUlid } from '../shared/datum';

type Rad = {
  id: string;
  kvar: number;
  fast: Fastnat | null;
  tid: string;
  tumnagel: string | null;
};

/**
 * Telefonens utkorg: bilder som ligger kvar på den här telefonen och ännu inte kommit
 * fram till servern.
 *
 * Den hade en egen skärm, `/telefon/uppladdning`, kallad "På väg till arkivet". Det gav
 * telefonen **två** listor som båda betydde "inte klart än" — utkorgen och aktiviteten
 * — och man fick titta på båda för att veta att allt gått i mål. Nu står utkorgen
 * överst i aktiviteten, som ett läge bland de andra, och skärmen är borttagen.
 *
 * Att listorna hämtar från olika håll ändras inte av det: **utkorgen är telefonens egen
 * disk, aktiviteten är serverns lista.** Därför visas den här bara i telefonläget —
 * datorn har ingen utkorg, och raden var alltid tom där.
 *
 * Bilderna hämtas ur köns egna bytes i IndexedDB, aldrig ur arkivet. Tumnaglarna pekade
 * en gång på `/api/receipts/:id/thumbs/1`, vilket är garanterat 404 här: raderna finns
 * definitionsmässigt kvar just därför att de ännu inte nått arkivet.
 */
@Component({
  selector: 'app-utkorg',
  imports: [RouterLink],
  templateUrl: './utkorg.component.html',
  styleUrl: './utkorg.component.css',
})
export class UtkorgComponent {
  private readonly queue = inject(QueueService);
  readonly state = this.queue.snapshot;

  /** Objekt-URL per kvitto, skapade ur köns egna bytes och släppta när raden går bort. */
  private readonly tumnaglar = signal<Record<string, string>>({});
  /** Bytes webbläsaren inte kunde avkoda. Tom ruta är ärligare än en brusten ikon. */
  private readonly trasiga = signal<ReadonlySet<string>>(new Set());

  readonly rader = computed<Rad[]>(() =>
    this.state().receipts.map((id) => ({
      id,
      kvar: this.state().pending.filter((key) => key.startsWith(`${id}:`)).length,
      fast: this.state().stuck.find((f) => f.id === id) ?? null,
      tid: tidpunktUrUlid(id),
      tumnagel: (this.trasiga().has(id) ? null : this.tumnaglar()[id]) ?? null,
    })),
  );

  /** Finns det något ett nytt försök kan lösa? Annars ska knappen inte stå där alls. */
  readonly harOmforsok = this.queue.harOmforsok;
  readonly offline = computed(() => this.state().offline);
  readonly forsoker = signal(false);

  /** Kvittot frågan om att kasta gäller. `null` när ingen fråga står på skärmen. */
  readonly fragar = signal<Rad | null>(null);
  private readonly fragan = viewChild<ElementRef<HTMLDialogElement>>('kastfraga');

  /** En läsning i taget: två överlappande gav dubbla URL:er för samma kvitto. */
  private kedja: Promise<void> = Promise.resolve();

  constructor() {
    this.queue.start();

    effect(() => {
      const ids = this.state().receipts;
      untracked(() => {
        this.kedja = this.kedja.then(() => this.laddaTumnaglar(ids)).catch(() => undefined);
      });
    });

    effect(() => {
      const el = this.fragan()?.nativeElement;
      if (!el) return;
      if (this.fragar() && !el.open) el.showModal();
      else if (!this.fragar() && el.open) el.close();
    });

    inject(DestroyRef).onDestroy(() => {
      for (const url of Object.values(this.tumnaglar())) URL.revokeObjectURL(url);
    });
  }

  /**
   * "Försök igen nu": bara när det finns något att försöka med.
   *
   * Knappen hade tidigare inget tillstånd alls. Offline gjorde den ingenting, och det
   * syntes inte; en bild servern avvisat med 415 släpptes och märktes om direkt, vilket
   * såg likadant ut. Nu säger knappen vad den kan göra innan den trycks.
   */
  async retry(): Promise<void> {
    if (this.offline() || !this.harOmforsok()) return;
    this.forsoker.set(true);
    try {
      await this.queue.retryStuck();
    } finally {
      this.forsoker.set(false);
    }
  }

  tumnagelTrasig(id: string): void {
    this.trasiga.update((s) => new Set(s).add(id));
  }

  fraga(rad: Rad): void {
    this.fragar.set(rad);
  }

  angra(): void {
    this.fragar.set(null);
  }

  /** Enda vägen ut för en bild servern aldrig kommer att ta emot. */
  async kasta(): Promise<void> {
    const rad = this.fragar();
    this.fragar.set(null);
    if (rad) await this.queue.discardReceipt(rad.id);
  }

  private async laddaTumnaglar(ids: string[]): Promise<void> {
    const kvar: Record<string, string> = {};
    for (const [id, url] of Object.entries(untracked(this.tumnaglar))) {
      if (ids.includes(id)) kvar[id] = url;
      else URL.revokeObjectURL(url);
    }
    for (const id of ids) {
      if (kvar[id]) continue;
      const [forsta] = await segmentsFor(id);
      // Är bilderna redan kvitterade finns inga bytes kvar lokalt. Då står en tom
      // ruta där i stället för en bild som inte finns någonstans.
      if (forsta) kvar[id] = URL.createObjectURL(new Blob([forsta.bytes], { type: 'image/jpeg' }));
    }
    this.tumnaglar.set(kvar);
  }
}
