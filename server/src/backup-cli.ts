/**
 * `backup` och `verify` som kommandon, för den som står vid maskinen eller vill lägga
 * kopieringen i en schemaläggare:
 *
 *   docker compose exec app node server/dist/backup-cli.js
 *   docker compose exec app node server/dist/backup-cli.js verify
 *   docker compose exec app node server/dist/backup-cli.js verify data
 */
import { loadConfig, humanBytes, ConfigError } from "./config.js";
import { BackupJob } from "./backup/job.js";

const config = loadConfig();
if (!config.backupDir) {
  throw new ConfigError("BACKUP_DIR är inte satt. Montera en katalog för säkerhetskopior.");
}
const job = new BackupJob(config.dataDir, config.backupDir);
const [command, target] = process.argv.slice(2);

if (command === "verify") {
  const dir = target === "data" ? config.dataDir : config.backupDir;
  const result = await job.verifyAgainstManifest(dir);
  console.log(`Kontrollerade ${result.checked} filer i ${dir}.`);
  for (const path of result.missing) console.error(`  SAKNAS  ${path}`);
  for (const path of result.corrupt) console.error(`  TRASIG  ${path}`);
  for (const path of result.extra) console.warn(`  EXTRA   ${path}`);
  console.log(result.ok ? "\nAllt stämmer mot manifestet." : "\nKopian stämmer INTE mot manifestet.");
  process.exitCode = result.ok ? 0 : 1;
} else {
  const summary = await job.run();
  if (summary.error) {
    console.error(`Säkerhetskopieringen misslyckades: ${summary.error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `${summary.receipts} kvitton, ${summary.files} filer, ${humanBytes(summary.bytes)} — ` +
        `${summary.copied} kopierade, ${summary.skipped} redan på plats, ` +
        `${(summary.durationMs / 1000).toFixed(1)} s.`,
    );
    console.log(`Manifest: ${summary.manifest}`);
    console.log(summary.ok ? "Kopian är kontrollerad mot manifestet och stämmer." : "KOPIAN STÄMMER INTE.");
    process.exitCode = summary.ok ? 0 : 1;
  }
}
