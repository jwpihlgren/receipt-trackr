import { ApplicationConfig, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    /**
     * Skalet ska gå att öppna utan nät. Kön i IndexedDB räddar bilder man hunnit ta,
     * men bara om fliken redan är öppen — i en butikskällare utan täckning laddades
     * ingenting alls, och då finns ingen app att fotografera med.
     *
     * Två sekunders fördröjning, inte Angulars standard `registerWhenStable:30000`.
     * Skillnaden är mätt: appen blir **aldrig** stabil — kön har en femtonsekunders
     * timer och tolkningen en på trettio — så standarden faller alltid tillbaka på
     * sin bortre gräns. Den som öppnade appen i en butik och stängde den efter tjugo
     * sekunder fick därför aldrig någon service worker, och nästa gång fanns inget
     * skal i cachen. Två sekunder räcker för att inte konkurrera med första
     * renderingen, och är kort nog att hinnas med under ett besök.
     */
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWithDelay:2000',
    }),
  ],
};
