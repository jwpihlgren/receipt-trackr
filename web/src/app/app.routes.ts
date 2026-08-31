import { Routes } from '@angular/router';

/**
 * Ytan står först i adressen, och sedan vad sidan innehåller: `/telefon/kvitton` och
 * `/dator/kvitton` är samma sak sedd från två håll. Tidigare hette de `/kvitton` och
 * `/arkiv`, vilket gav två namn åt en sak och dolde att det var ytan som skilde dem.
 *
 * Ytan väljs på rutt, inte på skärmbredd: en telefon i landskapsläge blir inte
 * plötsligt ett datorläge, och ett smalt fönster på skrivbordet blir inte en kamera.
 * Undantaget är `/`, som avgör en gång vart besökaren ska landa.
 *
 * Namnen i `title` är samma ord som står i menyn och som rubrik på sidan. Ett ställe,
 * ett namn.
 */
export const routes: Routes = [
  {
    path: 'logga-in',
    title: 'Logga in',
    loadComponent: () => import('./logga-in.component').then((m) => m.LoggaInComponent),
  },

  {
    path: 'telefon/kvitton',
    title: 'Kvitton',
    loadComponent: () => import('./mobile/lista.component').then((m) => m.ListaComponent),
  },
  {
    path: 'telefon/fanga',
    title: 'Fånga kvitto',
    loadComponent: () => import('./mobile/capture.component').then((m) => m.CaptureComponent),
  },
  {
    path: 'telefon/kvitto/:id',
    title: 'Kvitto',
    loadComponent: () => import('./desktop/kvitto.component').then((m) => m.KvittoComponent),
  },
  {
    path: 'telefon/aktivitet',
    title: 'Aktivitet',
    loadComponent: () => import('./desktop/aktivitet.component').then((m) => m.AktivitetComponent),
  },
  {
    path: 'telefon/uppladdning',
    title: 'På väg till arkivet',
    loadComponent: () => import('./mobile/upload.component').then((m) => m.UploadComponent),
  },

  {
    path: 'dator/kvitton',
    title: 'Kvitton',
    loadComponent: () => import('./desktop/arkiv.component').then((m) => m.ArkivComponent),
  },
  {
    path: 'dator/kvitto/:id',
    title: 'Kvitto',
    loadComponent: () => import('./desktop/kvitto.component').then((m) => m.KvittoComponent),
  },
  {
    path: 'dator/aktivitet',
    title: 'Aktivitet',
    loadComponent: () => import('./desktop/aktivitet.component').then((m) => m.AktivitetComponent),
  },
  {
    path: 'dator/analys',
    title: 'Analys',
    loadComponent: () => import('./desktop/analys.component').then((m) => m.AnalysComponent),
  },
  {
    path: 'dator/drift',
    title: 'Drift',
    loadComponent: () => import('./desktop/drift.component').then((m) => m.DriftComponent),
  },

  // ─── TILLFÄLLIG MÄTSIDA ────────────────────────────────────────────────
  // Står inte i menyn och ligger utanför ytorna med flit: den är inte en del av
  // appen. Tas bort genom att radera det här blocket och katalogen
  // `web/src/app/debug/`. Ingenting annat rör den.
  {
    path: 'debug',
    title: 'Mätsida',
    loadComponent: () => import('./debug/debug.component').then((m) => m.DebugComponent),
  },
  // ───────────────────────────────────────────────────────────────────────

  // Gamla adresser. Någon kan ha dem sparade.
  { path: 'kvitton', redirectTo: 'telefon/kvitton' },
  { path: 'fanga', redirectTo: 'telefon/fanga' },
  { path: 'uppladdning', redirectTo: 'telefon/uppladdning' },
  { path: 'arkiv', redirectTo: 'dator/kvitton' },
  { path: 'kvitto/:id', redirectTo: 'dator/kvitto/:id' },
  { path: 'aktivitet', redirectTo: 'dator/aktivitet' },
  { path: 'drift', redirectTo: 'dator/drift' },

  {
    path: '',
    pathMatch: 'full',
    /**
     * Vägvalet vid ingången, ställt en gång. Två villkor, och båda behövs: bredden
     * ensam duger inte (en telefon i landskap är bredare än 900 px), och pekaren ensam
     * duger inte (en pekskärmsdator rapporterar grov pekare fast den står på ett
     * skrivbord). Faller något av dem tillbaka på telefonytan är det rätt väg att
     * fela — den fungerar på en stor skärm, tvärtom gör den inte.
     */
    redirectTo: () =>
      matchMedia('(min-width: 900px) and (pointer: fine)').matches ? '/dator/kvitton' : '/telefon/kvitton',
  },
  { path: '**', redirectTo: '' },
];
