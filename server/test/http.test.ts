import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ulid } from "../src/store/ulid.js";

/** Multipart för hand: en beroendefri kropp är lättare att lita på än en generator. */
function multipart(field: string, filename: string, bytes: Buffer): { headers: Record<string, string>; payload: Buffer } {
  const boundary = "----receipttrackrtest";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, bytes, tail]),
  };
}

const jpeg = (width = 600, height = 800): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: "#cccccc" } }).jpeg().toBuffer();

describe("kvitto-API:t", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-http-"));
    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("201 för ett nytt kvitto, 200 när samma anrop kommer igen", async () => {
    const id = ulid();
    const first = await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    const again = await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });

    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(id);
  });

  it("400 utan id, 400 på ett id som inte är en ULID", async () => {
    expect((await app.inject({ method: "POST", url: "/api/receipts", payload: {} })).statusCode).toBe(400);
    const bad = await app.inject({ method: "POST", url: "/api/receipts", payload: { id: "hej" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("invalid_id");
  });

  it("tar emot ett segment och lämnar ut både bild och tumnagel", async () => {
    const id = ulid();
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    const bytes = await jpeg();

    const upload = await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/segments/1`,
      ...multipart("file", "segment.jpg", bytes),
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({ file: "segment-01.jpg", width: 600, height: 800 });

    const image = await app.inject({ method: "GET", url: `/api/receipts/${id}/files/segment-01.jpg` });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.from(image.rawPayload).equals(bytes)).toBe(true);

    const thumb = await app.inject({ method: "GET", url: `/api/receipts/${id}/files/thumb-01.webp` });
    expect(thumb.statusCode).toBe(404); // tumnageln ligger i derived/, inte bland originalen
  });

  it("409 när samma segmentnummer kommer med ett annat innehåll", async () => {
    const id = ulid();
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    await app.inject({ method: "POST", url: `/api/receipts/${id}/segments/1`, ...multipart("file", "a.jpg", await jpeg()) });

    const conflict = await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/segments/1`,
      ...multipart("file", "b.jpg", await jpeg(320, 240)),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("conflict");
  });

  it("415 när det som skickas inte är en bild", async () => {
    const id = ulid();
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    const bad = await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/segments/1`,
      ...multipart("file", "text.jpg", Buffer.from("inte en bild")),
    });
    expect(bad.statusCode).toBe(415);
  });

  it("vägrar ett filnamn som försöker ta sig ur katalogen", async () => {
    const id = ulid();
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    const escape = await app.inject({ method: "GET", url: `/api/receipts/${id}/files/..%2F..%2Freceipt.json` });
    expect(escape.statusCode).toBe(400);
  });

  it("404 för ett kvitto som inte finns", async () => {
    expect((await app.inject({ method: "GET", url: `/api/receipts/${ulid()}` })).statusCode).toBe(404);
  });
});
