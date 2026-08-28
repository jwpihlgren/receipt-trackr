import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_MIN_FREE_BYTES, humanBytes, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("kräver DATA_DIR och säger varför", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/ZFS-poolen/);
  });

  it("tolkar storlekar med enhet", () => {
    const cases: Array<[string, number]> = [
      ["5G", 5 * 1024 ** 3],
      ["500MB", 500 * 1024 ** 2],
      ["1073741824", 1024 ** 3],
      ["1,5G", Math.round(1.5 * 1024 ** 3)],
    ];
    for (const [raw, expected] of cases) {
      expect(loadConfig({ DATA_DIR: "/data", MIN_FREE_BYTES: raw }).minFreeBytes).toBe(expected);
    }
  });

  it("vägrar en storlek som inte går att tolka", () => {
    expect(() => loadConfig({ DATA_DIR: "/data", MIN_FREE_BYTES: "mycket" })).toThrow(/går inte att tolka/);
  });

  it("vägrar en port utanför intervallet", () => {
    expect(() => loadConfig({ DATA_DIR: "/data", PORT: "0" })).toThrow(/1–65535/);
    expect(() => loadConfig({ DATA_DIR: "/data", PORT: "1.5" })).toThrow(ConfigError);
  });

  it("faller tillbaka på golv, port och host som planen anger", () => {
    const config = loadConfig({ DATA_DIR: "/data" });
    expect(config.minFreeBytes).toBe(DEFAULT_MIN_FREE_BYTES);
    expect(config.port).toBe(8080);
    expect(config.host).toBe("0.0.0.0");
    expect(config.backupDir).toBeNull();
  });
});

describe("humanBytes", () => {
  it("skriver siffror en människa kan läsa i en runbook", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(5 * 1024 ** 3)).toBe("5.0 GiB");
    expect(humanBytes(1536)).toBe("1.5 KiB");
    expect(humanBytes(900 * 1024 ** 2)).toBe("900 MiB");
  });
});
