import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Reservationer } from "../src/jobb.js";

const bild = (): Promise<Buffer> =>
  sharp({ create: { width: 60, height: 180, channels: 3, background: { r: 250, g: 248, b: 244 } } })
    .jpeg()
    .toBuffer();

describe("Reservationer", () => {
  it("delar ut ett ledigt jobb och håller det borta från nästa som frågar", () => {
    const r = new Reservationer();
    expect(r.reservera(["a", "b"], "telefonen")).toHaveLength(2);
    expect(r.reservera(["a"], "datorn")).toHaveLength(0);
    expect(r.reserverad("a")).toBe(true);
  });

  it("släpper utgångna reservationer — soparen", () => {
    const r = new Reservationer(1000);
    const nu = Date.now();
    r.reservera(["a"], "telefonen", nu);
    expect(r.reserverad("a", nu + 500)).toBe(true);
    // Efter livslängden är jobbet ledigt igen, utan att någon behövt städa manuellt.
    expect(r.sopa(nu + 1001)).toEqual(["a"]);
    expect(r.reservera(["a"], "datorn", nu + 1001)).toHaveLength(1);
  });

  it("låter bara den som håller reservationen lämna tillbaka den", () => {
    const r = new Reservationer();
    r.reservera(["a"], "telefonen");
    // Annars kan en klient som kommit efter rycka undan ett pågående jobb.
    expect(r.aterlamna("a", "datorn")).toBe(false);
    expect(r.aterlamna("a", "telefonen")).toBe(true);
    expect(r.reserverad("a")).toBe(false);
  });
});

describe("jobbrutterna", () => {
  let dir: string;
  let app: FastifyInstance;
  let cookie: string;

  const PASSWORD = "tre ord som ni minns";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kvitto-jobb-"));
    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1", AUTH_PASSWORD: PASSWORD }), {
      logger: false,
    });
    const svar = await app.inject({ method: "POST", url: "/api/login", payload: { password: PASSWORD } });
    const raw = svar.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw[0]! : (raw as string)).split(";")[0]!;
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function laggUppKvitto(id: string): Promise<void> {
    await app.inject({ method: "POST", url: "/api/receipts", headers: { cookie }, payload: { id } });
    const form = new FormData();
    form.append("file", new Blob([await bild()], { type: "image/jpeg" }), "segment-1.jpg");
    await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/segments/1`,
      headers: { cookie },
      payload: form,
    });
    await app.inject({
      method: "POST",
      url: `/api/receipts/${id}/complete`,
      headers: { cookie },
      payload: { segments: 1 },
    });
  }

  const ID = "01M18WABG9Y3KZAED79J45DHPK";

  it("räknar otolkade kvitton, och slutar räkna dem när texten kommit in", async () => {
    await laggUppKvitto(ID);

    const fore = await app.inject({ method: "GET", url: "/api/jobb", headers: { cookie } });
    expect(fore.json().vantande).toBe(1);

    await app.inject({
      method: "POST",
      url: `/api/jobb/${ID}`,
      headers: { cookie },
      payload: { text: "HORNBACH Summa 1426,45", ocr: { niva: "tiny" } },
    });

    const efter = await app.inject({ method: "GET", url: "/api/jobb", headers: { cookie } });
    expect(efter.json().vantande).toBe(0);
  });

  it("lämnar ut jobbet med segmenten, och inte till två klienter samtidigt", async () => {
    await laggUppKvitto(ID);

    const forsta = await app.inject({
      method: "POST",
      url: "/api/jobb/hamta",
      headers: { cookie },
      payload: { arbetare: "telefonen", antal: 1 },
    });
    const jobb = forsta.json().jobb;
    expect(jobb).toHaveLength(1);
    expect(jobb[0].id).toBe(ID);
    expect(jobb[0].segments[0]).toMatchObject({ index: 1, file: "segment-01.jpg" });
    expect(jobb[0].segments[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    const andra = await app.inject({
      method: "POST",
      url: "/api/jobb/hamta",
      headers: { cookie },
      payload: { arbetare: "datorn", antal: 1 },
    });
    expect(andra.json().jobb).toHaveLength(0);
  });

  it("kräver att klienten säger vem den är", async () => {
    const svar = await app.inject({
      method: "POST",
      url: "/api/jobb/hamta",
      headers: { cookie },
      payload: { antal: 1 },
    });
    expect(svar.statusCode).toBe(400);
  });

  it("skriver texten så att den går att söka i", async () => {
    await laggUppKvitto(ID);
    await app.inject({
      method: "POST",
      url: `/api/jobb/${ID}`,
      headers: { cookie },
      payload: { text: "COOP KONSUM kanelbulle 12,00 SUMMA 284,50", ocr: null },
    });

    // Sökningen bortser från prickar: OCR förväxlar å/ä/ö åt båda hållen.
    const traff = await app.inject({ method: "GET", url: "/api/search?q=kanelbullé", headers: { cookie } });
    expect(traff.statusCode).toBe(200);
    expect(traff.json().hits.map((h: { id: string }) => h.id)).toContain(ID);
  });

  it("tar emot ett svar även efter att reservationen gått ut — arbetet är ändå gjort", async () => {
    await laggUppKvitto(ID);
    await app.inject({
      method: "POST",
      url: "/api/jobb/hamta",
      headers: { cookie },
      payload: { arbetare: "telefonen", antal: 1 },
    });
    const svar = await app.inject({
      method: "POST",
      url: `/api/jobb/${ID}`,
      headers: { cookie },
      payload: { text: "sent men rätt", ocr: null },
    });
    expect(svar.statusCode).toBe(200);
    expect(svar.json().tecken).toBe(13);
  });

  it("kräver inloggning som allt annat under /api", async () => {
    const svar = await app.inject({ method: "GET", url: "/api/jobb" });
    expect(svar.statusCode).toBe(401);
  });
});
