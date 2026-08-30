import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MenyComponent } from '../shared/meny.component';
import { QueueService } from './queue.service';

/**
 * Sidan visar bara det som **inte** är i arkivet. Är allt framme står här ingenting
 * att göra, och det är rätt: en lista över det som redan är klart är en lista ingen
 * behöver läsa.
 *
 * Uppladdningen startar av sig själv så fort en bild lagts i kön. Sidan är alltså
 * fönstret in i något som redan pågår, inte startknappen — och det står utskrivet,
 * så att ingen står och väntar på att trycka.
 */
@Component({
  selector: 'app-upload',
  host: { 'data-density': 'comfortable' },
  imports: [RouterLink, MenyComponent],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.css',
})
export class UploadComponent {
  private readonly queue = inject(QueueService);
  readonly state = this.queue.snapshot;

  readonly rader = computed(() =>
    this.state().receipts.map((id) => ({
      id,
      kvar: this.state().pending.filter((key) => key.startsWith(`${id}:`)).length,
      fast: this.state().stuck.includes(id),
      tid: tidUrUlid(id),
    })),
  );

  readonly sammanfattning = computed(() => {
    const n = this.state().receipts.length;
    if (n === 0) return null;
    return `${n} ${n === 1 ? 'kvitto är' : 'kvitton är'} inte i arkivet än. Uppladdningen sköter sig själv så länge appen är öppen.`;
  });

  readonly harFast = computed(() => this.state().stuck.length > 0);

  constructor() {
    this.queue.start();
  }

  retry(): Promise<void> {
    return this.queue.retryStuck();
  }
}

/** ULID:ens första 48 bitar är millisekunder sedan epoken — tiden finns i id:t. */
function tidUrUlid(id: string): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let ms = 0;
  for (const char of id.slice(0, 10)) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return '';
    ms = ms * 32 + value;
  }
  const d = new Date(ms);
  const idag = new Date().toDateString() === d.toDateString();
  const klocka = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return idag ? `I dag ${klocka}` : `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} ${klocka}`;
}
