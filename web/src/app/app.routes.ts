import { Routes } from '@angular/router';

/**
 * Ytorna väljs på rutt, inte på skärmbredd: en telefon i landskapsläge blir inte
 * plötsligt ett datorläge, och ett smalt fönster på skrivbordet blir inte en kamera.
 *
 * Undantaget är `/`, som avgör en gång vilken yta besökaren ska landa på. Det är ett
 * vägval vid ingången, inte en layout som slår om under fötterna på någon — och utan
 * det hamnar den som skriver in adressen på datorn i mobilläget.
 */
export const routes: Routes = [
  {
    path: 'logga-in',
    title: 'Logga in',
    loadComponent: () => import('./logga-in.component').then((m) => m.LoggaInComponent),
  },
  {
    path: 'kvitton',
    title: 'Kvitton',
    loadComponent: () => import('./mobile/lista.component').then((m) => m.ListaComponent),
  },
  {
    path: 'fanga',
    title: 'Fånga kvitto',
    loadComponent: () => import('./mobile/capture.component').then((m) => m.CaptureComponent),
  },
  {
    path: 'uppladdning',
    title: 'På väg till arkivet',
    loadComponent: () => import('./mobile/upload.component').then((m) => m.UploadComponent),
  },
  {
    path: 'arkiv',
    title: 'Kvittoarkiv',
    loadComponent: () => import('./desktop/arkiv.component').then((m) => m.ArkivComponent),
  },
  {
    path: 'kvitto/:id',
    title: 'Kvitto',
    loadComponent: () => import('./desktop/kvitto.component').then((m) => m.KvittoComponent),
  },
  {
    path: 'drift',
    title: 'Utrymme och drift',
    loadComponent: () => import('./desktop/drift.component').then((m) => m.DriftComponent),
  },
  {
    path: '',
    pathMatch: 'full',
    // Grov pekare betyder finger, alltså telefon. Frågan ställs en gång, vid ingången.
    redirectTo: () => (matchMedia('(pointer: coarse)').matches ? '/kvitton' : '/arkiv'),
  },
  { path: '**', redirectTo: '' },
];
