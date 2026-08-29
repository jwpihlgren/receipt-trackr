/**
 * Inloggningsrutterna och grinden framför allt annat.
 *
 * Två undantag från grinden, båda nödvändiga och båda medvetna:
 *
 *   /api/health — containerns egen HEALTHCHECK anropar den från loopback inuti
 *   containern, utan kaka. En grind över hela /api hade fått containern att
 *   rapportera sig själv som sjuk utan att något syns i loggen.
 *
 *   /api/login och /api/session — annars går det inte att logga in.
 *
 * De statiska filerna är också öppna. Det är skalet, inte innehållet: bilderna och
 * kvittona ligger bakom /api och är därmed skyddade. Utan öppet skal går inte
 * inloggningssidan att ladda.
 */
import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth.js";

const OPEN_PATHS = new Set(["/api/health", "/api/login", "/api/session"]);

/** Kom anropet in över https? Bakom en terminator är det headern som vet det. */
function isSecure(protocol: string, forwarded: string | string[] | undefined): boolean {
  if (protocol === "https") return true;
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return header?.split(",")[0]?.trim() === "https";
}

export function registerAuth(app: FastifyInstance, auth: Auth): void {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/")) return;
    if (OPEN_PATHS.has(path)) return;
    if (auth.accepts(request.headers.cookie)) return;
    return reply.code(401).send({ error: "unauthorized", message: "Logga in först." });
  });

  app.post<{ Body: { password?: string } }>("/api/login", async (request, reply) => {
    const password = request.body?.password;
    if (typeof password !== "string" || !(await auth.verify(password))) {
      // Ingen ledtråd om vad som var fel. Det finns bara ett fält.
      return reply.code(401).send({ error: "wrong_password", message: "Fel lösenordsfras." });
    }
    const secure = isSecure(request.protocol, request.headers["x-forwarded-proto"]);
    return reply.header("set-cookie", auth.cookie(auth.issue(), secure)).send({ ok: true });
  });

  app.post("/api/logout", async (request, reply) => {
    const secure = isSecure(request.protocol, request.headers["x-forwarded-proto"]);
    return reply.header("set-cookie", auth.clearedCookie(secure)).send({ ok: true });
  });

  /** Klienten frågar en gång vid start: ska jag visa arkivet eller inloggningen? */
  app.get("/api/session", async (request) => ({
    authenticated: auth.accepts(request.headers.cookie),
  }));
}

/** Utan inloggning finns ingen grind — men det ska synas i loggen, varje start. */
export function registerOpenSession(app: FastifyInstance): void {
  app.get("/api/session", async () => ({ authenticated: true, authDisabled: true }));
}
