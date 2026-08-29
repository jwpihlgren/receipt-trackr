/**
 * Inloggning för ett hushåll om två personer.
 *
 * Två avsiktliga enkelheter, båda motiverade av att det här är en burk i ett kök och
 * inte en tjänst på internet:
 *
 * 1. **Ingen användartabell.** Arkitekturens bärande premiss är att sidecar-filen är
 *    sanning och SQLite-indexet härlett — därför finns inga migrationer i systemet.
 *    En användartabell hade infört exakt den skuld designen finns till för att slippa,
 *    för två personers skull. Lösenordsfrasen står i miljön, som allt annat.
 *
 * 2. **Ingen cookie-modul.** Det är en signerad sträng, en Set-Cookie-rad och en
 *    parsning av en header. Ett beroende som ska överleva år av lågintensivt underhåll
 *    ska bära mer än så — samma regel som gäller IndexedDB-lagret i webben.
 *
 * Frasen jämförs aldrig direkt. Båda sidor går genom scrypt med samma salt, och
 * resultaten jämförs med timingSafeEqual. Att scrypt är långsamt är poängen: det är
 * det som gör gissning över nätet meningslös.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (p: string | Buffer, s: string | Buffer, k: number) => Promise<Buffer>;

export const COOKIE_NAME = "kvitto_session";
/** Ett halvår. Telefonen i fickan ska inte behöva loggas in var vecka. */
const SESSION_SECONDS = 180 * 24 * 60 * 60;

export class AuthError extends Error {}

/**
 * Hemligheten som signerar sessionen. Den lever i arkivkatalogen och skapas vid
 * första start — inte i miljön, därför att en hemlighet som byts vid varje omstart
 * loggar ut båda telefonerna varje gång containern startar om.
 */
async function loadSessionSecret(dataDir: string): Promise<Buffer> {
  const path = join(dataDir, ".session-secret");
  const existing = await readFile(path, "utf8").catch(() => null);
  if (existing?.trim()) return Buffer.from(existing.trim(), "hex");
  const secret = randomBytes(32);
  // 0600: filen är lika känslig som lösenordsfrasen — den som har den kan förfalska en session.
  await writeFile(path, secret.toString("hex"), { mode: 0o600 });
  return secret;
}

export type Auth = {
  /** Sant när frasen stämmer. Tar ~100 ms med flit. */
  verify(password: string): Promise<boolean>;
  issue(): string;
  accepts(cookieHeader: string | undefined): boolean;
  cookie(token: string, secure: boolean): string;
  clearedCookie(secure: boolean): string;
};

export async function openAuth(dataDir: string, password: string): Promise<Auth> {
  const secret = await loadSessionSecret(dataDir);
  const expected = await scrypt(password, secret, 32);

  const sign = (payload: string): string =>
    createHmac("sha256", secret).update(payload).digest("base64url");

  return {
    async verify(candidate: string): Promise<boolean> {
      if (typeof candidate !== "string" || candidate.length === 0) return false;
      const actual = await scrypt(candidate, secret, 32);
      return timingSafeEqual(actual, expected);
    },

    issue(): string {
      const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
      return `${expires}.${sign(String(expires))}`;
    },

    accepts(cookieHeader: string | undefined): boolean {
      const raw = readCookie(cookieHeader, COOKIE_NAME);
      if (!raw) return false;
      const dot = raw.lastIndexOf(".");
      if (dot < 1) return false;
      const expires = Number(raw.slice(0, dot));
      if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
      const given = Buffer.from(raw.slice(dot + 1));
      const want = Buffer.from(sign(String(expires)));
      return given.length === want.length && timingSafeEqual(given, want);
    },

    cookie(token: string, secure: boolean): string {
      // Secure sätts bara när anropet faktiskt kom över https. Över rå http på
      // hemnätet vore flaggan en tyst utloggning: webbläsaren skickar aldrig kakan.
      const parts = [
        `${COOKIE_NAME}=${token}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${SESSION_SECONDS}`,
      ];
      if (secure) parts.push("Secure");
      return parts.join("; ");
    },

    clearedCookie(secure: boolean): string {
      const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
      if (secure) parts.push("Secure");
      return parts.join("; ");
    },
  };
}

/** Cookie-headern är `a=1; b=2`. Värdet kan innehålla `=`, alltså delas bara på det första. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}
