/**
 * HTTP-lagret för kvitton. Tunt med flit: all logik som rör ordning och idempotens
 * ligger i `Archive`, så att den inte kan kringgås av en ny rutt.
 */
import type { FastifyError, FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { Archive, ConflictError, ImageError } from "../store/archive.js";
import { InvalidIdError, isSafeFileName } from "../store/paths.js";
import { count, ftsQuery, recent, search, unreviewed, unreviewedTotal } from "../store/index-db.js";
import { thumbName } from "../store/paths.js";

const CONTENT_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".webp": "image/webp" };

/** Metadatan är klientens; den sparas som den kommer, men bara om den är ett objekt. */
function parseCapture(field: unknown): Record<string, unknown> | undefined {
  const value = (field as { value?: unknown } | undefined)?.value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

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
      // Kamerans mätvärden vid fångst — texthöjd, skärpa, om avtryckaren var automatisk.
      // De går inte att rekonstruera i efterhand, så de tas emot här och sparas som de
      // kommer. Fältet måste ligga före filen i kroppen för att vara läst när filen är det.
      const capture = parseCapture(file.fields["capture"]);
      const { segment, created } = await archive.addSegment(
        request.params.id,
        Number(request.params.index),
        bytes,
        capture,
      );
      return reply.code(created ? 201 : 200).send(segment);
    },
  );

  app.post<{ Params: { id: string }; Body: { segments?: number } }>(
    "/api/receipts/:id/complete",
    async (request, reply) => {
      const segments = request.body?.segments;
      if (typeof segments !== "number") {
        return reply.code(400).send({ error: "missing_segments", message: "Ange hur många segment kvittot har." });
      }
      return reply.send(await archive.complete(request.params.id, segments));
    },
  );

  app.get<{ Querystring: { limit?: string; before?: string } }>("/api/receipts", async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit ?? 50) || 50, 1), 200);
    const before = request.query.before;
    return {
      total: count(archive.db),
      receipts: recent(archive.db, limit, before),
    };
  });

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

  app.get<{ Params: { id: string; index: string } }>(
    "/api/receipts/:id/thumbs/:index",
    async (request, reply) => {
      const index = Number(request.params.index);
      if (!Number.isInteger(index) || index < 1 || index > 99) return reply.code(400).send({ error: "invalid_index" });
      const path = archive.fileIn(request.params.id, join("derived", thumbName(index)));
      if (!(await stat(path).catch(() => null))?.isFile()) return reply.code(404).send({ error: "not_found" });
      return reply
        .type("image/webp")
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(createReadStream(path));
    },
  );

  app.get<{ Querystring: { q?: string } }>("/api/search", async (request, reply) => {
    const q = request.query.q?.trim();
    if (!q) return reply.code(400).send({ error: "missing_query" });
    const query = ftsQuery(q);
    if (!query) return reply.code(400).send({ error: "missing_query" });
    return { query, hits: search(archive.db, query) };
  });

  const FALT = new Set(["store", "date", "total", "currency"]);

  app.post<{ Params: { id: string }; Body: { namn?: string; value?: unknown; bekraftat?: boolean } }>(
    "/api/receipts/:id/falt",
    async (request, reply) => {
      const namn = request.body?.namn;
      if (!namn || !FALT.has(namn)) {
        return reply.code(400).send({ error: "okant_falt", message: `Fältet ska vara ett av ${[...FALT].join(", ")}.` });
      }
      if (request.body?.value === undefined) {
        return reply.code(400).send({ error: "missing_value", message: "Ange vad fältet ska bli." });
      }
      const receipt = await archive.rattaFalt(
        request.params.id,
        namn,
        request.body.value,
        request.body.bekraftat === true,
      );
      return reply.send(receipt);
    },
  );

  /**
   * Flera fält på en gång — det rättningspasset sparar när man går vidare till nästa
   * kvitto. Egen rutt i stället för en andra kroppsform på rutten ovanför: två
   * betydelser i samma URL är den sortens sparsamhet som kostar mer att läsa än den
   * sparar att skriva.
   */
  app.post<{ Params: { id: string }; Body: { rattelser?: { namn?: string; value?: unknown; bekraftat?: boolean }[] } }>(
    "/api/receipts/:id/falt/flera",
    async (request, reply) => {
      const rattelser = request.body?.rattelser;
      if (!Array.isArray(rattelser) || rattelser.length === 0) {
        return reply.code(400).send({ error: "missing_rattelser", message: "Skicka minst en rättelse." });
      }
      for (const rattelse of rattelser) {
        if (!rattelse?.namn || !FALT.has(rattelse.namn)) {
          return reply
            .code(400)
            .send({ error: "okant_falt", message: `Fältet ska vara ett av ${[...FALT].join(", ")}.` });
        }
        if (rattelse.value === undefined) {
          return reply.code(400).send({ error: "missing_value", message: "Ange vad fältet ska bli." });
        }
      }
      const receipt = await archive.rattaFalten(
        request.params.id,
        rattelser.map((r) => ({ namn: r.namn as string, value: r.value, bekraftat: r.bekraftat === true })),
      );
      return reply.send(receipt);
    },
  );

  /**
   * Arbetslistan för ett rättningspass, och hur lång den är i sin helhet.
   *
   * `total` är hela kön, `receipts` är den bit passet orkar med i ett svep. Arkivet
   * använder samma rutt med `limit=1` bara för att få siffran — en kö man ska gå in i
   * med avsikt behöver synas innan man går in i den.
   */
  app.get<{ Querystring: { limit?: string } }>("/api/pass", async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit ?? 100) || 100, 1), 500);
    return { total: unreviewedTotal(archive.db), receipts: unreviewed(archive.db, limit) };
  });

  app.post("/api/reindex", async () => archive.reindex());

  // Omtolkning är inte samma sak som omindexering. `reindex` bygger om det härledda
  // indexet ur sidecarerna; det här räknar om *fälten* ur texten som redan lästs, och
  // är vägen att låta förbättrade regler nå kvitton som tolkades i går.
  app.post("/api/falt/omtolka", async () => archive.reextract());
}
