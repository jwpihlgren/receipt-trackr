import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { assertAuthConfigured, StartupError } from "../src/startup.js";
import { COOKIE_NAME, openAuth, readCookie } from "../src/auth.js";

const PASSWORD = "tre ord som ni båda minns";

describe("inloggning", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kvitto-auth-"));
    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1", AUTH_PASSWORD: PASSWORD }), {
      logger: false,
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const login = async (password: string) =>
    app.inject({ method: "POST", url: "/api/login", payload: { password } });

  const cookieFrom = (response: { headers: Record<string, unknown> }): string => {
    const raw = response.headers["set-cookie"];
    return (Array.isArray(raw) ? raw[0] : (raw as string)).split(";")[0]!;
  };

  it("släpper inte in någon utan kaka", async () => {
    const response = await app.inject({ method: "GET", url: "/api/receipts" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("unauthorized");
  });

  it("svarar 401 på fel fras, utan att avslöja vad som var fel", async () => {
    const response = await login("fel fras");
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe("Fel lösenordsfras.");
  });

  it("släpper in med rätt fras och ger en kaka som fungerar", async () => {
    const response = await login(PASSWORD);
    expect(response.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/api/receipts",
      headers: { cookie: cookieFrom(response) },
    });
    expect(listed.statusCode).toBe(200);
  });

  it("sätter inte Secure över rå http — då hade webbläsaren aldrig skickat kakan", async () => {
    const raw = (await login(PASSWORD)).headers["set-cookie"];
    const header = Array.isArray(raw) ? raw[0]! : (raw as string);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Secure");
  });

  it("sätter Secure när terminatorn säger att anropet kom över https", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: PASSWORD },
      headers: { "x-forwarded-proto": "https" },
    });
    const raw = response.headers["set-cookie"];
    expect(Array.isArray(raw) ? raw[0]! : (raw as string)).toContain("Secure");
  });

  it("avvisar en förfalskad signatur", async () => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const response = await app.inject({
      method: "GET",
      url: "/api/receipts",
      headers: { cookie: `${COOKIE_NAME}=${expires}.detharardefinitivtingenriktigsignatur` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("avvisar en kaka som gått ut, även med giltig signatur", async () => {
    const auth = await openAuth(dir, PASSWORD);
    const past = Math.floor(Date.now() / 1000) - 60;
    // Signaturen är äkta; det är bara tiden som passerat.
    const forged = auth.issue().replace(/^\d+/, String(past));
    expect(auth.accepts(`${COOKIE_NAME}=${forged}`)).toBe(false);
  });

  it("lämnar /api/health öppen — containerns hälsokontroll har ingen kaka", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
  });

  it("svarar på om sessionen lever, utan att kräva en", async () => {
    const before = await app.inject({ method: "GET", url: "/api/session" });
    expect(before.json().authenticated).toBe(false);

    const cookie = cookieFrom(await login(PASSWORD));
    const after = await app.inject({ method: "GET", url: "/api/session", headers: { cookie } });
    expect(after.json().authenticated).toBe(true);
  });

  it("loggar ut genom att nolla kakan", async () => {
    const cookie = cookieFrom(await login(PASSWORD));
    const response = await app.inject({ method: "POST", url: "/api/logout", headers: { cookie } });
    const raw = response.headers["set-cookie"];
    expect(Array.isArray(raw) ? raw[0]! : (raw as string)).toContain("Max-Age=0");
  });

  it("hittar rätt kaka bland flera, även när värdet innehåller likhetstecken", () => {
    expect(readCookie("a=1; kvitto_session=17.abc=def; b=2", COOKIE_NAME)).toBe("17.abc=def");
    expect(readCookie("annat=1", COOKIE_NAME)).toBeNull();
    expect(readCookie(undefined, COOKIE_NAME)).toBeNull();
  });
});

describe("startkontrollen för inloggning", () => {
  const base = { dataDir: "/data", backupDir: null, host: "0.0.0.0", port: 8080, minFreeBytes: 1, webRoot: null };

  it("vägrar starta utan lösenordsfras", () => {
    expect(() => assertAuthConfigured({ ...base, authPassword: null, authDisabled: false })).toThrow(StartupError);
    expect(() => assertAuthConfigured({ ...base, authPassword: null, authDisabled: false })).toThrow(/AUTH_PASSWORD saknas/);
  });

  it("startar utan fras bara när någon uttryckligen menat det", () => {
    expect(() => assertAuthConfigured({ ...base, authPassword: null, authDisabled: true })).not.toThrow();
    expect(() => assertAuthConfigured({ ...base, authPassword: "x", authDisabled: false })).not.toThrow();
  });
});
