import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './shared/auth.service';

/**
 * Roten är ett skal. Allt utseende hör till ytorna, som väljs på rutt.
 *
 * Det enda skalet gör är att fråga en gång om sessionen lever. Utan den frågan får den
 * utloggade se ett tomt arkiv med felmeddelanden i stället för en inloggningsruta —
 * vilket ser ut som att burken är sönder.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    void this.auth.check().then((ok) => {
      if (!ok && !location.pathname.startsWith('/logga-in')) {
        void this.router.navigateByUrl('/logga-in');
      }
    });
  }
}
