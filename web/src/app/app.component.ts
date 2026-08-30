import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { AuthService } from './shared/auth.service';

/**
 * Roten är ett skal. Allt utseende hör till ytorna, som väljs på rutt.
 *
 * Skalet gör två saker. Det frågar en gång om sessionen lever — utan den frågan får
 * den utloggade se ett tomt arkiv med felmeddelanden i stället för en inloggningsruta,
 * vilket ser ut som att burken är sönder. Och det tar emot en ny version tyst.
 */
/** Rutter där en omladdning skulle kasta något som bara finns i minnet. */
const ARBETE_PAGAR = ['/telefon/fanga', '/telefon/kvitto/', '/dator/kvitto/'];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly uppdatering = inject(SwUpdate);

  constructor() {
    // Bara ett bestämt nej skickar vidare. `null` betyder att servern inte gick att
    // nå, och det är inte ett skäl att visa en inloggningsruta man ändå inte kan
    // logga in i — skalet kommer ur cachen och fångsten fungerar utan nät.
    void this.auth.check().then((svar) => {
      if (svar === false && !location.pathname.startsWith('/logga-in')) {
        void this.router.navigateByUrl('/logga-in');
      }
    });

    /**
     * En ny version tas i bruk tyst, utan att fråga.
     *
     * Ingen ruta om att "en uppdatering finns" — appen är appen, och den ska inte
     * prata med sin användare om sig själv. Men den får inte heller ladda om under
     * händerna på någon: fångstens bilder och ett halvskrivet fält lever bara i
     * minnet. Står vi på en sådan skärm väntar bytet, och tjänsten tar den vid nästa
     * öppning ändå. Kön överlever alltid — den ligger i IndexedDB.
     */
    if (this.uppdatering.isEnabled) {
      this.uppdatering.versionUpdates.subscribe((handelse) => {
        if (handelse.type !== 'VERSION_READY') return;
        if (ARBETE_PAGAR.some((rutt) => location.pathname.startsWith(rutt))) return;
        void this.uppdatering.activateUpdate().then(() => location.reload());
      });
    }
  }
}
