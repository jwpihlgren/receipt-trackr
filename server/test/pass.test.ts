import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ulid } from "../src/store/ulid.js";

const jpeg = (): Promise<Buffer> =>
  sharp({ create: { width: 400, height: 900, channels: 3, background: "#cccccc" } }).jpeg().toBuffer();

/** Multipart för hand, som i http-testet: en beroendefri kropp är lättare att lita på. */
function multipart(bytes: Buffer): { headers: Record<string, string>; payload: Buffer } {
  const boundary = "----receipttrackrtest";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="s.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`,
  );
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  };
}

describe("rättningspasset", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-pass-"));
    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  /** Ett fångat kvitto. Utan text är det otolkat och hör till tolkningskön, inte hit. */
  async function fanga(id: string): Promise<void> {
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    await app.inject({ method: "POST", url: `/api/receipts/${id}/segments/1`, ...multipart(await jpeg()) });
    await app.inject({ method: "POST", url: `/api/receipts/${id}/complete`, payload: { segments: 1 } });
  }

  async function tolka(id: string, text: string): Promise<void> {
    await app.inject({ method: "POST", url: `/api/jobb/${id}`, payload: { text, ocr: null } });
  }

  const KVITTO = "COOP KONSUM\n2026-08-29\nkanelbulle 12,00\nATT BETALA 284,50";

  it("tar upp tolkade kvitton med maskinlästa fält, och lämnar otolkade utanför", async () => {
    const tolkat = ulid();
    const otolkat = ulid();
    await fanga(tolkat);
    await fanga(otolkat);
    await tolka(tolkat, KVITTO);

    const pass = await app.inject({ method: "GET", url: "/api/pass" });
    expect(pass.statusCode).toBe(200);
    expect(pass.json().total).toBe(1);
    expect(pass.json().receipts).toHaveLength(1);
    expect(pass.json().receipts[0]).toMatchObject({ id: tolkat, store: "Coop", unreviewed: 3 });
  });

  it("räknar ner allteftersom fälten granskas, och sinar när alla tre är sedda", async () => {
    const id = ulid();
    await fanga(id);
    await tolka(id, KVITTO);

    await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/falt`,
      payload: { namn: "store", value: "Coop", bekraftat: true },
    });
    expect((await app.inject({ method: "GET", url: "/api/pass" })).json().receipts[0].unreviewed).toBe(2);

    await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/falt/flera`,
      payload: {
        rattelser: [
          { namn: "date", value: "2026-08-29", bekraftat: true },
          { namn: "total", value: 284.5, bekraftat: false },
        ],
      },
    });

    const efter = await app.inject({ method: "GET", url: "/api/pass" });
    expect(efter.json().total).toBe(0);
    expect(efter.json().receipts).toHaveLength(0);
  });

  it("skriver en post per fält i corrections, med en enda tidsstämpel för ett enda tryck", async () => {
    const id = ulid();
    await fanga(id);
    await tolka(id, KVITTO);

    const svar = await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/falt/flera`,
      payload: {
        rattelser: [
          { namn: "store", value: "Coop Konsum Kungsholmen", bekraftat: false },
          { namn: "total", value: 284.5, bekraftat: true },
        ],
      },
    });
    expect(svar.statusCode).toBe(200);

    const { corrections, fields } = svar.json();
    expect(corrections).toHaveLength(2);
    expect(corrections[0]).toMatchObject({ field: "store", to: "Coop Konsum Kungsholmen", action: "corrected" });
    // Bekräftelsen är en post trots att värdet inte ändrades: utan den går ett fält
    // ingen tittat på inte att skilja från ett någon granskat och godkänt.
    expect(corrections[1]).toMatchObject({ field: "total", to: 284.5, action: "confirmed" });
    expect(corrections[1].fromConfidence).toBeTypeOf("number");
    expect(corrections[0].at).toBe(corrections[1].at);
    expect(fields.store).toMatchObject({ source: "manual", confidence: 1 });
    expect(fields.total).toMatchObject({ source: "confirmed", confidence: 1 });
  });

  it("avvisar en tom lista och ett fält som inte finns", async () => {
    const id = ulid();
    await fanga(id);
    await tolka(id, KVITTO);

    const tom = await app.inject({ method: "POST", url: `/api/receipts/${id}/falt/flera`, payload: { rattelser: [] } });
    expect(tom.statusCode).toBe(400);

    const okant = await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/falt/flera`,
      payload: { rattelser: [{ namn: "moms", value: 12 }] },
    });
    expect(okant.statusCode).toBe(400);
    expect(okant.json().error).toBe("okant_falt");
  });

  it("bygger om indexet av sig självt när schemaversionen är en annan", async () => {
    const id = ulid();
    await fanga(id);
    await tolka(id, KVITTO);
    await app.close();

    // Så ser ett index från en äldre version ut inifrån: rätt innehåll, fel schema.
    // Ingen migration körs — tabellerna kastas och sidecarerna läses om.
    const db = new Database(join(dir, "index.sqlite"));
    db.pragma("user_version = 1");
    db.close();

    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
    const pass = await app.inject({ method: "GET", url: "/api/pass" });
    expect(pass.json().total).toBe(1);
    expect(pass.json().receipts[0].id).toBe(id);
  });
});
