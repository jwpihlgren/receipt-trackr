import { Routes } from '@angular/router';

/**
 * Ytorna väljs på rutt, inte på skärmbredd: en telefon i landskapsläge blir inte
 * plötsligt ett datorläge, och ett smalt fönster på skrivbordet blir inte en kamera.
 * Mobilläget laddas separat så att telefonen inte hämtar datorlägets kod innan den
 * kan fotografera.
 */
export const routes: Routes = [
  {
    path: 'fanga',
    title: 'Fånga kvitto',
    loadComponent: () => import('./mobile/capture.component').then((m) => m.CaptureComponent),
  },
  {
    path: 'kvitton',
    title: 'Kvitton',
    loadComponent: () => import('./mobile/receipts.component').then((m) => m.ReceiptsComponent),
  },
  {
    path: 'drift',
    title: 'Drift',
    loadComponent: () => import('./desktop/drift.component').then((m) => m.DriftComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'fanga' },
];
