import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Handelser } from "../src/handelser.js";
import { registerHandelser } from "../src/http/handelser.js";
import { ulid } from "../src/store/ulid.js";

describe("händelsebussen", () => {
  it("lämnar tillbaka en avlyssning som faktiskt tar bort lyssnaren", () => {
    const bussen = new Handelser();
    const sedda: string[] = [];
    const sluta = bussen.lyssna((h) => sedda.push(h.id));

    bussen.sand({ typ: "kvitto", id: "ett" });
    sluta();
    bussen.sand({ typ: "kvitto", id: "tva" });

    expect(sedda).toEqual(["ett"]);
    expect(bussen.antal).toBe(0);
  });

  it("låter en trasig lyssnare vara trasig utan att stoppa de andra", () => {
    const bussen = new Handelser();
    const sedda: string[] = [];
    bussen.lyssna(() => {
      throw new Error("uppkopplingen är död");
    });
    bussen.lyssna((h) => sedda.push(h.id));

    // Kastar den här blir en lyckad skrivning ett fel, för `sand` anropas efter att
    // sidecaren och indexet redan ligger på disk.
    expect(() => bussen.sand({ typ: "kvitto", id: "ett" })).not.toThrow();
    expect(sedda).toEqual(["ett"]);
  });
});

describe("strömmen ur arkivet", () => {
  let dir: string;
  let app: FastifyInstance;
  let bas: string;

  /** Öppnar strömmen och läser ": ansluten", så att lyssnaren säkert är registrerad. */
  async function anslut(): Promise<{
    nasta: () => Promise<string>;
    stang: () => void;
  }> {
    const avbryt = new AbortController();
    const svar = await fetch(`${bas}/api/handelser`, { signal: avbryt.signal });
    expect(svar.headers.get("content-type")).toContain("text/event-stream");
    const lasare = svar.body!.getReader();
    await lasare.read();
    return {
      nasta: async () => new TextDecoder().decode((await lasare.read()).value),
      stang: () => avbryt.abort(),
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "receipt-trackr-handelser-"));
    app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    bas = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const skapa = (id: string): Promise<Response> =>
    fetch(`${bas}/api/receipts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });

  it("svarar med huvuden som gör svaret till en ström, inte ett anrop", async () => {
    const avbryt = new AbortController();
    const svar = await fetch(`${bas}/api/handelser`, { signal: avbryt.signal });
    expect(svar.headers.get("content-type")).toContain("text/event-stream");
    expect(svar.headers.get("cache-control")).toBe("no-store");
    // Utan den här buffrar en mellanlagrare strömmen, och ingenting syns förrän den
    // stängs — vilket är samma sak som att inte ha någon ström.
    expect(svar.headers.get("x-accel-buffering")).toBe("no");
    avbryt.abort();
  });

  it("säger vilket kvitto som skrevs", async () => {
    const strom = await anslut();
    const id = ulid();
    await skapa(id);

    expect(await strom.nasta()).toBe(`data: {"typ":"kvitto","id":"${id}"}\n\n`);
    strom.stang();
  });

  it("säger borttaget, inte skrivet, när kvittot raderas", async () => {
    const id = ulid();
    await skapa(id);

    const strom = await anslut();
    await fetch(`${bas}/api/receipts/radera`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [id], bekraftelse: "radera" }),
    });

    expect(await strom.nasta()).toBe(`data: {"typ":"borttaget","id":"${id}"}\n\n`);
    strom.stang();
  });

  it("når två uppkopplade klienter var för sig", async () => {
    const en = await anslut();
    const tva = await anslut();
    const id = ulid();
    await skapa(id);

    expect(await en.nasta()).toContain(id);
    expect(await tva.nasta()).toContain(id);
    en.stang();
    tva.stang();
  });
});

/**
 * Städningen prövas mot en egen buss, för det är antalet lyssnare som är påståendet —
 * och det går inte att se utifrån. Utan städning låg en lyssnare och en pulstimer kvar
 * per stängd flik och skrev till en död ström vid varje skrivning i arkivet.
 */
describe("strömmen städar efter sig", () => {
  it("tar bort sin lyssnare när klienten kopplar ner", async () => {
    const bussen = new Handelser();
    const app = Fastify({ logger: false });
    registerHandelser(app, bussen);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      const avbryt = new AbortController();
      const svar = await fetch(`http://127.0.0.1:${port}/api/handelser`, { signal: avbryt.signal });
      const lasare = svar.body!.getReader();
      await lasare.read();
      expect(bussen.antal).toBe(1);

      avbryt.abort();
      // Socketens `close` kommer en bit efter avbrottet.
      for (let i = 0; i < 100 && bussen.antal > 0; i++) await new Promise((k) => setTimeout(k, 20));
      expect(bussen.antal).toBe(0);
    } finally {
      await app.close();
    }
  });
});
