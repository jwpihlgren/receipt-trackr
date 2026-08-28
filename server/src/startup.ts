/**
 * Startkontrollerna. Servern vägrar starta hellre än att starta i ett läge där en
 * backloggkörning kan fylla disken — bilderna är oåterkalleliga, allt annat är det
 * inte, och en server som är nere är ett mycket billigare fel än en full boot-disk.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { humanBytes, type Config } from "./config.js";
import { inspectDisk, type DiskReport } from "./disk.js";

export class StartupError extends Error {}

export type StartupReport = {
  data: DiskReport;
  writable: true;
  minFreeBytes: number;
};

async function assertWritable(dir: string, label: string): Promise<void> {
  const probe = join(dir, `.write-probe-${process.pid}`);
  try {
    await writeFile(probe, "");
  } catch (cause) {
    throw new StartupError(`${label} (${dir}) går inte att skriva till: ${(cause as Error).message}`);
  } finally {
    await rm(probe, { force: true });
  }
}

/**
 * Kontrollerar $DATA_DIR och, om den är satt, $BACKUP_DIR. Kastar StartupError med
 * ett meddelande skrivet för någon som står vid maskinen, inte för en stack trace.
 */
export async function checkStorage(config: Config): Promise<StartupReport> {
  await mkdir(config.dataDir, { recursive: true });
  await assertWritable(config.dataDir, "DATA_DIR");
  if (config.backupDir) {
    await mkdir(config.backupDir, { recursive: true });
    await assertWritable(config.backupDir, "BACKUP_DIR");
  }

  const data = await inspectDisk(config.dataDir);
  if (data.freeBytes < config.minFreeBytes) {
    throw new StartupError(
      `För lite ledigt utrymme på ${data.path}: ${humanBytes(data.freeBytes)} kvar, ` +
        `golvet är ${humanBytes(config.minFreeBytes)}. ` +
        `Monteringspunkt ${data.mount ?? "okänd"} (${data.filesystem ?? "okänt filsystem"}). ` +
        `Servern startar inte: en backloggkörning här skulle fylla disken. ` +
        `Frigör utrymme, peka DATA_DIR mot ZFS-poolen, eller sänk MIN_FREE_BYTES medvetet.`,
    );
  }
  return { data, writable: true, minFreeBytes: config.minFreeBytes };
}

/** Varning, inte fel: eMMC:n på kortet är rätt katalog för ingenting och lätt att råka peka på. */
export function warnIfSuspiciousMount(report: StartupReport): string | null {
  const fs = report.data.filesystem;
  if (!fs || fs === "zfs") return null;
  return (
    `DATA_DIR ligger på ${report.data.mount ?? "okänd monteringspunkt"} (${fs}), inte på ZFS. ` +
    `Planen säger att arkivet hör hemma på poolen, inte på kortets eMMC — kontrollera att det är avsiktligt.`
  );
}
