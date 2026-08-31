import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { QueueService } from '../mobile/queue.service';
import { AktivitetService } from './aktivitet.service';
import { AuthService } from './auth.service';
import { HandelserService } from './handelser.service';

/**
 * Hamburgaren och lådan bakom den. Allt som inte är fångstflödet bor här, så att
 * skärmen kan ägna sig åt kvittona.
 *
 * Samma meny på båda ytorna. Den låg först bara på telefonen, och skrivbordet hade en
 * rad tunna länkar uppe till höger i stället — två olika navigeringsspråk i samma app,
 * vilket gjorde det oklart var man var och hur man kom tillbaka. Nu finns en meny, med
 * samma destinationer, och den bär också vägen till den andra ytan.
 *
 * "Kom inte fram" har en egen rad, skild från "på väg". Det är Apples uppdelning:
 * det som löser sig självt formuleras som väntan och stör ingen, medan det som
 * kräver en människa får en egen plats att synas på.
 */
@Component({
  selector: 'app-meny',
  imports: [RouterLink],
  templateUrl: './meny.component.html',
})
export class MenyComponent {
  private readonly queue = inject(QueueService);
  private readonly aktivitet = inject(AktivitetService);
  private readonly auth = inject(AuthService);
  private readonly handelser = inject(HandelserService);
  private readonly router = inject(Router);

  /** Vilken yta menyn sitter på. Styr bara vilken av lägeslänkarna som visas. */
  readonly lage = input<'mobil' | 'dator'>('mobil');

  readonly open = signal(false);
  private readonly state = this.queue.snapshot;
  private readonly lada = viewChild<ElementRef<HTMLDialogElement>>('lada');

  readonly fast = computed(() => this.state().stuck.length);

  /**
   * Hur många kvitton som inte är klara. Siffran satt tidigare som en egen rad överst
   * i arkivet, alltså på den skärm där ingenting behövde göras. Här står den i stället
   * bredvid vägen till det som ska göras, och syns från varje skärm.
   */
  readonly ofardiga = this.aktivitet.antal;

  /**
   * Vad som återstår sett från telefonen: serverns ofärdiga **plus** det som ligger
   * kvar i telefonens egen utkorg. Två siffror var rimligt när utkorgen hade en egen
   * skärm. Nu leder båda till samma lista, och då ska det stå en siffra — annars
   * påstår menyn att det finns två högar att beta av.
   */
  readonly attGora = computed(() => this.ofardiga() + this.state().receipts.length);

  constructor() {
    /**
     * Menyn står på varje skärm, så det är den som håller strömmen öppen — och
     * siffran är därför sann även när den ändras av någon annan enhet medan lådan
     * står öppen. Siffran hämtas bara när något faktiskt hänt, inte på en klocka.
     */
    inject(DestroyRef).onDestroy(this.handelser.folj(() => void this.aktivitet.hamta()));

    // Signalen styr, <dialog> visar. `showModal()` är det som ger Esc, fokusfälla
    // och inert bakgrund; attributet `open` ger utseendet men inget av det.
    effect(() => {
      const el = this.lada()?.nativeElement;
      if (!el) return;
      if (this.open() && !el.open) el.showModal();
      else if (!this.open() && el.open) el.close();
    });
  }

  toggle(): void {
    const öppnas = !this.open();
    this.open.set(öppnas);
    // Siffran hämtas när lådan öppnas, inte på en klocka: den syns bara här, och en
    // återkommande fråga i bakgrunden vore arbete ingen tittar på.
    if (öppnas) void this.aktivitet.hamta();
  }

  close(): void {
    this.open.set(false);
  }

  async logout(): Promise<void> {
    this.close();
    await this.auth.logout();
    await this.router.navigateByUrl('/logga-in');
  }
}
