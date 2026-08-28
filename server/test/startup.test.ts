import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { checkStorage, StartupError } from "../src/startup.js";
import { writeArkivformat, ARKIVFORMAT_FILE } from "../src/arkivformat.js";
import { buildApp } from "../src/app.js";

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "receipt-trackr-test-"));
}

describe("checkStorage", () => {
  it("skapar DATA_DIR om den saknas och rapporterar var den ligger", async () => {
    const dir = await scratch();
    try {
      const nested = join(dir, "data");
      const report = await checkStorage(loadConfig({ DATA_DIR: nested, MIN_FREE_BYTES: "1" }));
      expect((await stat(nested)).isDirectory()).toBe(true);
      expect(report.data.freeBytes).toBeGreaterThan(0);
      expect(report.data.totalBytes).toBeGreaterThan(report.data.freeBytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("vägrar starta under golvet, och säger vad man gör åt det", async () => {
    const dir = await scratch();
    try {
      // Ett golv ingen disk kan möta: kontrollen ska fälla, inte hoppas på att den gör det.
      const config = loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "999999TB" });
      await expect(checkStorage(config)).rejects.toThrow(StartupError);
      await expect(checkStorage(config)).rejects.toThrow(/Servern startar inte/);
      await expect(checkStorage(config)).rejects.toThrow(/ZFS-poolen|MIN_FREE_BYTES/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("arkivformatet", () => {
  it("skrivs in i arkivet och beskriver var kvittona ligger", async () => {
    const dir = await scratch();
    try {
      const file = await writeArkivformat(dir);
      const text = await readFile(file, "utf8");
      expect(file.endsWith(ARKIVFORMAT_FILE)).toBe(true);
      expect(text).toMatch(/receipts\/<år>\/<månad>\/<ULID>/);
      // Skrivordningen är den enda regel en reparatör måste känna till.
      expect(text).toMatch(/skrivs alltid först, och atomiskt/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("/api/health", () => {
  it("svarar ok med utrymme och monteringspunkt", async () => {
    const dir = await scratch();
    const app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("ok");
      expect(body.data.belowFloor).toBe(false);
      expect(body.data.free).toMatch(/(B|KiB|MiB|GiB|TiB)$/);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("svarar 503 och degraded när utrymmet fallit under golvet", async () => {
    const dir = await scratch();
    const app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "999999TB" }), { logger: false });
    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(503);
      expect(response.json().status).toBe("degraded");
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ger 404 som JSON för okända API-vägar", async () => {
    const dir = await scratch();
    const app = await buildApp(loadConfig({ DATA_DIR: dir, MIN_FREE_BYTES: "1" }), { logger: false });
    try {
      const response = await app.inject({ method: "GET", url: "/api/finns-inte" });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
