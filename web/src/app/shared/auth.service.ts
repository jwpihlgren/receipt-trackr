/**
 * Sessionen, sett från klienten. En fråga vid start ("är jag inloggad?") och två
 * åtgärder. Ingen token lagras här: kakan är httpOnly och osynlig för JavaScript,
 * vilket är hela poängen med den.
 */
import { Injectable, signal } from '@angular/core';

type SessionSvar = { authenticated: boolean; authDisabled?: boolean };

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** `null` = vi vet inte än. Skalet visar ingenting förrän frågan är besvarad. */
  readonly authenticated = signal<boolean | null>(null);

  async check(): Promise<boolean> {
    try {
      const response = await fetch('/api/session');
      const body = (await response.json()) as SessionSvar;
      this.authenticated.set(body.authenticated);
      return body.authenticated;
    } catch {
      // Servern svarar inte. Det är inte samma sak som utloggad, men det finns inget
      // att visa arkivet med heller — inloggningsvyn är den enda som fungerar utan nät.
      this.authenticated.set(false);
      return false;
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
