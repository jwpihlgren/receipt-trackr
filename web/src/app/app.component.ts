import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Roten är ett skal. Allt utseende hör till ytorna, som väljs på rutt. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {}
