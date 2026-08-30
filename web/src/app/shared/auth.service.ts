/**
 * Sessionen, sett från klienten. En fråga vid start ("är jag inloggad?") och två
 * åtgärder. Ingen token lagras här: kakan är httpOnly och osynlig för JavaScript,
 * vilket är hela poängen med den.
 */
import { Injectable, signal } from '@angular/core';

type SessionSvar = { authenticated: boolean; authDisabled?: boolean };

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** `null` = vi vet inte. Antingen ännu inte frågat, eller frågat utan att nå servern. */
  readonly authenticated = signal<boolean | null>(null);

  /**
   * @returns `true` inloggad, `false` utloggad, `null` — vet inte, servern svarade inte.
   *
   * De tre är inte två. Utan nät svarade tjänsten tidigare "utloggad", och skalet
   * kastade den som stod i en butikskällare till en inloggningsruta som inte går att
   * logga in i. Sedan appen har en service worker är det fel svar: skalet finns i
   * cachen, kameran fungerar, och kön tar emot bilder utan att servern är nådd.
   * Okänt är okänt, och då står man kvar där man var.
   */
  async check(): Promise<boolean | null> {
    try {
      const response = await fetch('/api/session');
      if (!response.ok && response.status !== 401 && response.status !== 403) return null;
      const body = (await response.json()) as SessionSvar;
      this.authenticated.set(body.authenticated);
      return body.authenticated;
    } catch {
      return null;
    }
  }

  async login(password: string): Promise<boolean> {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    this.authenticated.set(response.ok);
    return response.ok;
  }

  async logout(): Promise<void> {
    await fetch('/api/logout', { method: 'POST' }).catch(() => undefined);
    this.authenticated.set(false);
  }
}
