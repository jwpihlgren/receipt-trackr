/**
 * Bygger HTTP-lagret utan att lyssna på någon port, så att testerna kan skjuta in
 * anrop med `app.inject()` i stället för att binda ett uttag. Startkontrollerna
 * ligger medvetet utanför: de hör till processens uppstart, inte till appen.
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import { stat } from "node:fs/promises";
import type { Config } from "./config.js";
import { registerHealth } from "./http/health.js";

export async function buildApp(config: Config, options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, ...options });

  registerHealth(app, config);

  // Webbygget serveras av samma process: en image, en tjänst, en port (krav 52).
  if (config.webRoot && (await stat(config.webRoot).catch(() => null))?.isDirectory()) {
    await app.register(fastifyStatic, { root: config.webRoot });
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
