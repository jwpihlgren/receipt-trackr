/**
 * Bygger HTTP-lagret utan att lyssna på någon port, så att testerna kan skjuta in
 * anrop med `app.inject()` i stället för att binda ett uttag. Startkontrollerna
 * ligger medvetet utanför: de hör till processens uppstart, inte till appen.
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { stat } from "node:fs/promises";
import type { Config } from "./config.js";
import { registerHealth } from "./http/health.js";
import { registerAuth, registerOpenSession } from "./http/auth.js";
import { openAuth } from "./auth.js";
import { registerReceipts } from "./http/receipts.js";
import { registerBackup } from "./http/backup.js";
import { BackupJob } from "./backup/job.js";
import { Archive } from "./store/archive.js";

export async function buildApp(config: Config, options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, ...options });

  // Ett kvittosegment är ett telefonfoto: taket är satt för att rymma det med god
  // marginal, inte för att vara generöst.
  await app.register(fastifyMultipart, { limits: { fileSize: 32 * 1024 * 1024, files: 1 } });

  const archive = Archive.open(config.dataDir);
  app.addHook("onClose", () => archive.close());

  registerHealth(app, config);

  // Grinden registreras före rutterna den skyddar. Utan lösenordsfras finns ingen
  // grind: index.ts vägrar starta i det läget, så hit når bara testerna och en
  // uttrycklig AUTH_DISABLED.
  if (config.authPassword) {
    registerAuth(app, await openAuth(config.dataDir, config.authPassword));
  } else {
    app.log.warn("Ingen AUTH_PASSWORD satt — API:t är öppet för alla som når porten.");
    registerOpenSession(app);
  }

  registerReceipts(app, archive);
  // Utan monterad katalog finns ingen säkerhetskopiering — rutterna svarar då 503
  // med ett begripligt skäl i stället för att saknas.
  registerBackup(app, config.backupDir ? new BackupJob(config.dataDir, config.backupDir) : null, config.dataDir);

  /**
   * Cross-origin isolation. Utan de här två headerna får sidan ingen SharedArrayBuffer,
   * och utan den kör onnxruntimes WASM entrådat — vilket är skillnaden mellan att tolka
   * ett kvitto och att vänta på att tolka ett kvitto.
   *
   * Priset är att sidan inte får bädda in något från en annan domän. Det kostar oss
   * ingenting: appen hämtar varken CDN-skript, webbfonter eller bilder utifrån, och ska
   * inte göra det heller — burken ska fungera utan internet. Skulle någon en dag lägga
   * till en extern resurs slutar den ladda, tyst, och då är det den här kommentaren man
   * ska hitta.
   */
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("cross-origin-embedder-policy", "require-corp");
  });

  // Webbygget serveras av samma process: en image, en tjänst, en port (krav 52).
  if (config.webRoot && (await stat(config.webRoot).catch(() => null))?.isDirectory()) {
    await app.register(fastifyStatic, {
      root: config.webRoot,
      // Egna resurser måste märkas som inbäddningsbara när sidan är isolerad.
      setHeaders: (res) => res.setHeader("cross-origin-resource-policy", "same-origin"),
    });
    // Djuplänkar i klientroutern ska ge appen, inte 404 — men aldrig för /api.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  } else if (config.webRoot) {
    app.log.warn({ webRoot: config.webRoot }, "WEB_ROOT pekar inte på en katalog — kör som rent API");
  }

  return app;
}
