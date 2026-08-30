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

describe("aktiviteten", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-aktivitet-"));
    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function fanga(id: string, segments = 1): Promise<void> {
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    await app.inject({ method: "POST", url: `/api/receipts/${id}/segments/1`, ...multipart(await jpeg()) });
    await app.inject({ method: "POST", url: `/api/receipts/${id}/complete`, payload: { segments } });
  }

  const tolka = (id: string, text: string) =>
    app.inject({ method: "POST", url: `/api/jobb/${id}`, payload: { text, ocr: { niva: "tiny" } } });

  const HELT = "COOP KONSUM\n2026-08-29\nATT BETALA 284,50";

  const rader = async () => (await app.inject({ method: "GET", url: "/api/aktivitet" })).json();

  /**
   * Kärnan i hela vyn: ett kvitto som gått hela vägen står inte i tabellen. Att ingen
   * kvitterat fälten gör det inte ofärdigt, och låg konfidens gör det inte heller.
   */
  it("lämnar ett färdigt kvitto utanför, hur okvitterat det än är", async () => {
    const id = ulid();
    await fanga(id);
    await tolka(id, HELT);

    const svar = await rader();
    expect(svar.receipts).toHaveLength(0);
    expect(svar.total).toBe(1);
    expect(svar.vantar).toBe(0);
  });

  it("tar upp det som väntar på tolkning — ofärdigt är ofärdigt", async () => {
    const id = ulid();
    await fanga(id);

    const svar = await rader();
    expect(svar.vantar).toBe(1);
    expect(svar.receipts).toHaveLength(1);
    expect(svar.receipts[0]).toMatchObject({ id, lage: "vantar" });
  });

  it("tar upp en fångst som aldrig avslutades", async () => {
    const id = ulid();
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    await app.inject({ method: "POST", url: `/api/receipts/${id}/segments/1`, ...multipart(await jpeg()) });

    expect((await rader()).receipts[0]).toMatchObject({ id, lage: "ofullstandig" });
  });

  /** En förlorad bild går inte att ta om, och väger därför tyngre än allt annat. */
  it("sätter saknade bilder före övrigt som saknas på samma kvitto", async () => {
    const id = ulid();
    await fanga(id, 3);
    await tolka(id, "text utan datum eller summa");

    expect((await rader()).receipts[0]).toMatchObject({ id, lage: "bilder", saknadeBilder: 2 });
  });

  it("tar upp en tolkning som inte gav ett tecken", async () => {
    const id = ulid();
    await fanga(id);
    await tolka(id, "");

    expect((await rader()).receipts[0]).toMatchObject({ id, lage: "utan_text", saknadeFalt: [] });
  });

  it("namnger fälten maskinen inte hittade", async () => {
    const id = ulid();
    await fanga(id);
    await tolka(id, "NAGON TEXT UTAN NAGOT ALLS");

    // Butiken saknas nästan aldrig: utvinningen tar översta raden som kandidat, och
    // ett kvitto har alltid en översta rad. Datum och belopp är de som kan utebli.
    const rad = (await rader()).receipts[0];
    expect(rad.lage).toBe("saknar_falt");
    expect(rad.saknadeFalt).toEqual(["datum", "belopp"]);
  });

  it("släpper kvittot ur tabellen när fältet skrivits in för hand", async () => {
    const id = ulid();
    await fanga(id);
    await tolka(id, "COOP KONSUM\n2026-08-29\nnagot utan summa");
    expect((await rader()).receipts[0].saknadeFalt).toEqual(["belopp"]);

    await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/falt`,
      payload: { namn: "total", value: 284.5 },
    });

    expect((await rader()).receipts).toHaveLength(0);
  });

  it("bygger om indexet av sig självt när schemaversionen är en annan", async () => {
    const id = ulid();
    await fanga(id, 3);
    await tolka(id, HELT);
    await app.close();

    const db = new Database(join(dir, "index.sqlite"));
    db.pragma("user_version = 1");
    db.close();

    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
    const svar = await app.inject({ method: "GET", url: "/api/aktivitet" });
    expect(svar.json().receipts[0]).toMatchObject({ id, lage: "bilder", saknadeBilder: 2 });
  });

});

describe("kalibreringsurvalet", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-urval-"));
    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function tolkatKvitto(): Promise<string> {
    const id = ulid();
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id } });
    await app.inject({ method: "POST", url: `/api/receipts/${id}/segments/1`, ...multipart(await jpeg()) });
    await app.inject({ method: "POST", url: `/api/receipts/${id}/complete`, payload: { segments: 1 } });
    await app.inject({
      method: "POST",
      url: `/api/jobb/${id}`,
      payload: { text: "COOP KONSUM\n2026-08-29\nATT BETALA 284,50", ocr: null },
    });
    return id;
  }

  it("drar alla tolkade kvitton när de är färre än urvalets storlek", async () => {
    await tolkatKvitto();
    await tolkatKvitto();
    // Ett otolkat kvitto har inga fält att pröva mot bilden och ska inte dras.
    await app.inject({ method: "POST", url: "/api/receipts", payload: { id: ulid() } });

    const drag = await app.inject({ method: "POST", url: "/api/granskning/urval", payload: { antal: 100 } });
    expect(drag.json()).toMatchObject({ dragna: 2, urval: 2, kvarAttDra: 0 });

    const lage = await app.inject({ method: "GET", url: "/api/granskning" });
    expect(lage.json()).toMatchObject({ urval: 2, granskade: 0, kvar: 2, dragbara: 0 });
    expect(lage.json().receipts).toHaveLength(2);
  });

  it("drar bara upp till måttstorleken, och fyller på när högen vuxit", async () => {
    await tolkatKvitto();
    await tolkatKvitto();
    await tolkatKvitto();

    const forst = await app.inject({ method: "POST", url: "/api/granskning/urval", payload: { antal: 2 } });
    expect(forst.json()).toMatchObject({ dragna: 2, urval: 2, kvarAttDra: 1 });

    // Samma måttstorlek igen drar ingenting: urvalet är redan så stort.
    const igen = await app.inject({ method: "POST", url: "/api/granskning/urval", payload: { antal: 2 } });
    expect(igen.json().dragna).toBe(0);

    const storre = await app.inject({ method: "POST", url: "/api/granskning/urval", payload: { antal: 3 } });
    expect(storre.json()).toMatchObject({ dragna: 1, urval: 3 });
  });

  it("skriver utfallet och rättelserna i samma skrivning, och lämnar kön", async () => {
    const id = await tolkatKvitto();
    await app.inject({ method: "POST", url: "/api/granskning/urval", payload: { antal: 100 } });

    const svar = await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/granskning`,
      payload: {
        verdict: "wrong",
        dwellMs: 4200,
        sawImage: true,
        rattelser: [{ namn: "total", value: 285.5, bekraftat: false }],
      },
    });
    expect(svar.statusCode).toBe(200);
    expect(svar.json().review).toMatchObject({ sampled: true, verdict: "wrong", dwellMs: 4200, sawImage: true });
    expect(svar.json().review.reviewedAt).toBeTruthy();
    // Rättelsen bär konfidensen fältet hade innan — det är hela mätvärdet.
    expect(svar.json().corrections).toHaveLength(1);
    expect(svar.json().corrections[0].fromConfidence).toBeTypeOf("number");

    const lage = await app.inject({ method: "GET", url: "/api/granskning" });
    expect(lage.json()).toMatchObject({ urval: 1, granskade: 1, kvar: 0 });
    expect(lage.json().receipts).toHaveLength(0);
  });

  /**
   * Draget och granskningen är två skilda fakta. Utan den skillnaden går ett kvitto
   * någon råkade titta på inte att skilja från ett som slumpen valde, och urvalet
   * slutar vara ett urval.
   */
  it("gör inte ett granskat kvitto till en del av urvalet", async () => {
    const id = await tolkatKvitto();
    await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/granskning`,
      payload: { verdict: "correct", sawImage: true },
    });

    const receipt = await app.inject({ method: "GET", url: `/api/receipts/${id}` });
    expect(receipt.json().review).toMatchObject({ sampled: false, verdict: "correct" });

    const lage = await app.inject({ method: "GET", url: "/api/granskning" });
    expect(lage.json()).toMatchObject({ urval: 0, granskade: 0 });
  });

  it("avvisar ett utfall som inte finns", async () => {
    const id = await tolkatKvitto();
    const bad = await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/granskning`,
      payload: { verdict: "kanske" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("okant_utfall");
  });
});
