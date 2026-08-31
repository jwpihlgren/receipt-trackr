import { Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';

/**
 * Grinden framför en radering.
 *
 * Att radera är det enda i arkivet som inte går att ta tillbaka: bilderna är
 * sanningen, papperet är slängt, och det finns ingen papperskorg. Därför står ett
 * **skrivet ord** mellan tanken och handlingen, och därför bor rutan på ett ställe i
 * stället för att skrivas av på varje skärm som raderar. En spärr som finns i två
 * kopior är en spärr som snart finns i en och en halv.
 *
 * Ordet prövas också av servern. Det som står här är en artighet; spärren är serverns.
 */
@Component({
  selector: 'app-radera-ruta',
  templateUrl: './radera-ruta.component.html',
})
export class RaderaRutaComponent {
  /** Hur många kvitton som ska bort. Noll stänger rutan. */
  readonly antal = input.required<number>();
  /** Sant medan raderingen pågår. */
  readonly arbetar = input(false);
  /** Rad som förklarar vad som följer med, när det inte är självklart. */
  readonly tillagg = input<string | null>(null);

  readonly bekraftat = output<string>();
  readonly avbrutet = output<void>();

  private readonly rutan = viewChild<ElementRef<HTMLDialogElement>>('rutan');
  readonly ordet = signal('');

  /** Ordet som öppnar grinden. Ett ord man skriver, inte en knapp man råkar träffa. */
  readonly ratt = computed(() => this.ordet().trim().toLocaleLowerCase('sv') === 'radera');

  constructor() {
    effect(() => {
      const el = this.rutan()?.nativeElement;
      if (el && !el.open) {
        this.ordet.set('');
        el.showModal();
      }
    });
  }

  skriv(event: Event): void {
    this.ordet.set((event.target as HTMLInputElement).value);
  }

  stang(): void {
    this.rutan()?.nativeElement.close();
    this.avbrutet.emit();
  }

  bekrafta(): void {
    // Ordet skickas vidare i stället för att antas: servern prövar det som skrevs,
    // inte en konstant klienten hittat på.
    if (this.ratt()) this.bekraftat.emit(this.ordet());
  }
}
