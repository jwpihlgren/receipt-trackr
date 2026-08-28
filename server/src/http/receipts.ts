/**
 * HTTP-lagret för kvitton. Tunt med flit: all logik som rör ordning och idempotens
 * ligger i `Archive`, så att den inte kan kringgås av en ny rutt.
 */
import type { FastifyError, FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Archive, ConflictError, ImageError } from "../store/archive.js";
import { InvalidIdError, isSafeFileName } from "../store/paths.js";
import { search } from "../store/index-db.js";

const CONTENT_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".webp": "image/webp" };

export function registerReceipts(app: FastifyInstance, archive: Archive): void {
  // Fel översätts på ett ställe i stället för i varje rutt.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof InvalidIdError) return reply.code(400).send({ error: "invalid_id", message: error.message });
    if (error instanceof ImageError) return reply.code(415).send({ error: "not_an_image", message: error.message });
    if (error instanceof ConflictError) return reply.code(409).send({ error: "conflict", message: error.message });
    app.log.error(error);
    const status = typeof error.statusCode === "number" ? error.statusCode : 500;
    return reply.code(status).send({ error: "internal", message: error.message });
  });

  app.post<{ Body: { id?: string; capturedAt?: string; backlog?: boolean } }>(
    "/api/receipts",
    async (request, reply) => {
      const { id, capturedAt, backlog } = request.body ?? {};
      if (!id) return reply.code(400).send({ error: "missing_id", message: "Klienten ska skicka en ULID som id." });
      const { receipt, created } = await archive.create({
        id,
        ...(capturedAt ? { capturedAt } : {}),
        ...(backlog === undefined ? {} : { backlog }),
      });
      // 200 vid omtag, 201 vid nytt: klienten ska kunna se skillnaden utan att gissa.
      return reply.code(created ? 201 : 200).send(receipt);
    },
  );

  app.post<{ Params: { id: string; index: string } }>(
    "/api/receipts/:id/segments/:index",
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "missing_file", message: "Bilden ska skickas som multipart." });
      const bytes = await file.toBuffer();
      const { segment, created } = await archive.addSegment(request.params.id, Number(request.params.index), bytes);
      return reply.code(created ? 201 : 200).send(segment);
    },
  );

  app.get<{ Params: { id: string } }>("/api/receipts/:id", async (request, reply) => {
    const receipt = await archive.get(request.params.id);
    if (!receipt) return reply.code(404).send({ error: "not_found" });
    return receipt;
  });

  // Bilderna lämnas ut direkt ur arkivet — de är oföränderliga, så de får cachas hårt.
  app.get<{ Params: { id: string; name: string } }>("/api/receipts/:id/files/:name", async (request, reply) => {
    const { id, name } = request.params;
    if (!isSafeFileName(name)) return reply.code(400).send({ error: "invalid_name" });
    const path = archive.fileIn(id, name);
    if (!(await stat(path).catch(() => null))?.isFile()) return reply.code(404).send({ error: "not_found" });
    const ext = name.slice(name.lastIndexOf("."));
    return reply
      .type(CONTENT_TYPES[ext] ?? "application/octet-stream")
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(createReadStream(path));
  });

  app.get<{ Querystring: { q?: string } }>("/api/search", async (request, reply) => {
    const q = request.query.q?.trim();
    if (!q) return reply.code(400).send({ error: "missing_query" });
    // Frågan är användarens text, inte FTS5-syntax: den citeras så att en apostrof
    // eller ett bindestreck inte blir ett syntaxfel i stället för en sökning.
    return { hits: search(archive.db, `"${q.replace(/"/g, '""')}"`) };
  });

  app.post("/api/reindex", async () => archive.reindex());
}
