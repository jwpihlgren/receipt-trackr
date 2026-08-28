/**
 * Säkerhetskopiering över HTTP. Startas av en knapp i datorläget (M7) och går att
 * följa medan den kör. `verify` finns som egen rutt därför att kontrollen är
 * meningsfull även utan en ny kopiering — särskilt efter en återställning.
 */
import type { FastifyInstance } from "fastify";
import type { BackupJob } from "../backup/job.js";

export function registerBackup(app: FastifyInstance, job: BackupJob | null, dataDir: string): void {
  const unavailable = {
    error: "no_backup_dir",
    message: "BACKUP_DIR är inte satt. Montera en katalog för säkerhetskopior och starta om.",
  };

  app.get("/api/backup", async (_request, reply) => (job ? job.status() : reply.code(503).send(unavailable)));

  app.post("/api/backup", async (_request, reply) => {
    if (!job) return reply.code(503).send(unavailable);
    if (job.isRunning) return reply.code(409).send({ error: "already_running", ...job.status() });
    // Svaret kommer direkt; förloppet följs via GET. En kopiering av tiotusen kvitton
    // tar minuter, och ingen ska sitta med ett hängande anrop under tiden.
    void job.run().catch((error: unknown) => app.log.error(error));
    return reply.code(202).send(job.status());
  });

  app.post<{ Querystring: { target?: string } }>("/api/backup/verify", async (request, reply) => {
    if (!job) return reply.code(503).send(unavailable);
    // `target=data` kontrollerar arkivet efter en återställning, annars kopian.
    try {
      return await job.verifyAgainstManifest(request.query.target === "data" ? dataDir : undefined);
    } catch (error) {
      return reply.code(404).send({ error: "no_manifest", message: (error as Error).message });
    }
  });
}
