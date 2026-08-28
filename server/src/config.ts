/**
 * All konfiguration läses en gång, vid start, och valideras då. Ett fel i miljön
 * ska stoppa servern med ett begripligt meddelande — inte visa sig som ett
 * konstigt beteende timmar senare, mitt i en backloggkörning.
 */
import { resolve } from "node:path";

export type Config = {
  dataDir: string;
  backupDir: string | null;
  host: string;
  port: number;
  /** Golv för ledigt utrymme på $DATA_DIR. Under detta vägrar servern starta. */
  minFreeBytes: number;
  /** Statiska filer från webbygget. Saknas de körs servern som rent API. */
  webRoot: string | null;
};

const GIB = 1024 ** 3;

/** 5 GiB. Räkneexemplet i planen landar på ~30 GB totalt, så golvet är inte arkivets
 *  storlek utan marginalen som gör att en pågående körning hinner stoppas i tid. */
export const DEFAULT_MIN_FREE_BYTES = 5 * GIB;

export class ConfigError extends Error {}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new ConfigError(
      `${key} saknas. Sätt den till katalogen på ZFS-poolen där arkivet ska ligga, ` +
        `aldrig till kortets eMMC (se planens avsnitt om diskplacering).`,
    );
  }
  return value;
}

function parseBytes(raw: string, key: string): number {
  const match = /^(\d+(?:[.,]\d+)?)\s*(b|k|kb|m|mb|g|gb|t|tb)?$/i.exec(raw.trim());
  if (!match) throw new ConfigError(`${key} går inte att tolka som en storlek: "${raw}". Exempel: 5G, 500MB, 1073741824.`);
  const factor = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: GIB, gb: GIB, t: 1024 ** 4, tb: 1024 ** 4 };
  const unit = (match[2] ?? "b").toLowerCase() as keyof typeof factor;
  return Math.round(Number(match[1]!.replace(",", ".")) * factor[unit]);
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT måste vara ett heltal 1–65535, inte "${raw}".`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const minFree = env.MIN_FREE_BYTES?.trim();
  const backup = env.BACKUP_DIR?.trim();
  const web = env.WEB_ROOT?.trim();
  return {
    dataDir: resolve(requireEnv(env, "DATA_DIR")),
    backupDir: backup ? resolve(backup) : null,
    // 0.0.0.0 i containern; TLS termineras utanför av `tailscale serve`.
    host: env.HOST?.trim() || "0.0.0.0",
    port: parsePort(env.PORT?.trim() || "8080"),
    minFreeBytes: minFree ? parseBytes(minFree, "MIN_FREE_BYTES") : DEFAULT_MIN_FREE_BYTES,
    webRoot: web ? resolve(web) : null,
  };
}

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** Läsbar storlek för logg och health — siffror i byte säger ingenting i en runbook. */
export function humanBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}
