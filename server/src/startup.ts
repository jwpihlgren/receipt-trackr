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
    const hint =
      (cause as NodeJS.ErrnoException).code === "EACCES"
        ? ` Vanligaste orsaken i container: katalogen på värden saknades när containern ` +
          `startade, och då skapar Docker den åt sig med root som ägare — medan servern ` +
          `kör som en vanlig användare. Rätta på värden, inte i containern: ` +
          `sudo chown -R $(id -u):$(id -g) <katalogen som ${label} pekar på i .env>`
        : "";
    throw new StartupError(`${label} (${dir}) går inte att skriva till: ${(cause as Error).message}.${hint}`);
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

/**
 * Vägrar starta utan lösenordsfras. Samma regel som diskgolvet: ett fel i miljön ska
 * stoppa servern med ett begripligt meddelande, inte visa sig som ett konstigt
 * beteende senare — och här är det konstiga beteendet ett skrivbart arkiv öppet för
 * hela hemnätet.
 */
export function assertAuthConfigured(config: Config): void {
  if (config.authPassword) return;
  if (config.authDisabled) {
    console.warn(
      "AUTH_DISABLED=true — servern startar utan inloggning. Allt som når porten kan " +
        "läsa och skriva i arkivet.",
    );
    return;
  }
  throw new StartupError(
    "AUTH_PASSWORD saknas. Sätt en lösenordsfras för hushållet i .env, till exempel\n" +
      '  AUTH_PASSWORD="tre ord som ni båda minns"\n' +
      "Servern publiceras på hemnätet och har inget annat skydd. Vill du ändå köra utan " +
      "inloggning, sätt AUTH_DISABLED=true och mena det.",
  );
}
