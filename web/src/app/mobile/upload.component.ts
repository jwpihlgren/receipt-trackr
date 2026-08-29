import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { QueueService } from './queue.service';

/**
 * Uppladdningsvyn. En egen sida, dit man går när man är klar med en omgång kvitton
 * och vill se att de kommit fram.
 *
 * Uppladdningen startar av sig själv så fort en bild lagts i kön — den väntar aldrig
 * på ett knapptryck. Skälet är att en telefon som tappas i golvet mellan fotografering
 * och uppladdning tar papperet med sig, och papperet finns inte kvar. Den här vyn är
 * alltså inte startknappen, den är fönstret in i något som redan pågår.
 */
@Component({
  selector: 'app-upload',
  host: { 'data-density': 'comfortable' },
  imports: [RouterLink],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.css',
})
export class UploadComponent {
  private readonly queue = inject(QueueService);
  private readonly router = inject(Router);

  readonly state = this.queue.snapshot;

  /** Ett kvitto i taget, med hur många av dess bilder som är kvar att skicka. */
  readonly rows = computed(() =>
    this.state().receipts.map((id) => ({
      id,
      kvar: this.state().pending.filter((key) => key.startsWith(`${id}:`)).length,
      stuck: this.state().stuck.includes(id),
    })),
  );

  readonly done = computed(() => this.rows().length === 0);

  readonly heading = computed(() => {
    const s = this.state();
    if (s.stuck.length) return `${s.stuck.length} kom inte fram`;
    if (this.done()) return s.archivedToday ? `Allt i arkivet · ${s.archivedToday} i dag` : 'Inget att ladda upp';
    if (s.offline) return `${s.receipts.length} väntar på nät`;
    return `${s.receipts.length} på väg till arkivet`;
  });

  retry(): void {
    void this.queue.drain();
  }

  back(): void {
    void this.router.navigate(['/fanga']);
  }
}
