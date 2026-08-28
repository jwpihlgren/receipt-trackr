/**
 * `/api/health` svarar på den fråga runbooken ställer först: ligger arkivet där det
 * ska, och hur mycket är kvar? Utrymmet läses om vid varje anrop — en statfs är
 * billig, och en siffra från uppstarten för tre veckor sedan är värdelös.
 *
 * Servern *vägrar starta* under golvet, men en redan igång server stannar inte av
 * sig själv: den svarar `degraded`. Att stoppa jobbkön är rätt åtgärd, och den hör
 * hemma i M5 där kön finns.
 */
import type { FastifyInstance } from "fastify";
import { humanBytes, type Config } from "../config.js";
import { inspectDisk } from "../disk.js";
import { VERSION } from "../version.js";

export function registerHealth(app: FastifyInstance, config: Config): void {
  app.get("/api/health", async (_request, reply) => {
    const data = await inspectDisk(config.dataDir);
    const belowFloor = data.freeBytes < config.minFreeBytes;
    if (belowFloor) reply.code(503);
    return {
      status: belowFloor ? "degraded" : "ok",
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      data: {
        path: data.path,
        mount: data.mount,
        filesystem: data.filesystem,
        freeBytes: data.freeBytes,
        free: humanBytes(data.freeBytes),
        totalBytes: data.totalBytes,
        total: humanBytes(data.totalBytes),
        minFreeBytes: config.minFreeBytes,
        minFree: humanBytes(config.minFreeBytes),
        belowFloor,
      },
      backupDir: config.backupDir,
    };
  });
}
