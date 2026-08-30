import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './shared/auth.service';

/**
 * Ett fält, en knapp. Frasen är gemensam för hushållet, så det finns inget
 * användarnamn att fylla i och ingen kontoåterställning att erbjuda — den som
 * glömt frasen läser den i .env på burken.
 */
@Component({
  selector: 'app-logga-in',
  host: { 'data-density': 'comfortable' },
  imports: [],
  templateUrl: './logga-in.component.html',
})
export class LoggaInComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  onInput(event: Event): void {
    this.password.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.password()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (await this.auth.login(this.password())) {
        this.password.set('');
        await this.router.navigateByUrl('/');
      } else {
        this.error.set('Fel lösenordsfras.');
      }
    } catch {
      this.error.set('Ingen kontakt. Kontrollera att du är på hemnätet eller Tailscale.');
    } finally {
      this.busy.set(false);
    }
  }
}
