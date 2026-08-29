import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { QueueService } from './queue.service';
import { AuthService } from '../shared/auth.service';

/**
 * Hamburgaren och lådan bakom den. Allt som inte är fångstflödet bor här, så att
 * skärmen kan ägna sig åt kvittona.
 *
 * "Kom inte fram" har en egen rad, skild från "på väg". Det är Apples uppdelning:
 * det som löser sig självt formuleras som väntan och stör ingen, medan det som
 * kräver en människa får en egen plats att synas på.
 */
@Component({
  selector: 'app-meny',
  imports: [RouterLink],
  templateUrl: './meny.component.html',
  styleUrl: './meny.component.css',
})
export class MenyComponent {
  private readonly queue = inject(QueueService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly open = signal(false);
  private readonly state = this.queue.snapshot;

  readonly pavag = computed(() => this.state().waiting - this.state().stuck.length);
  readonly fast = computed(() => this.state().stuck.length);

  toggle(): void {
    this.open.update((o) => !o);
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
