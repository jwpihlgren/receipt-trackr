/**
 * Serverns entrépunkt. En process som senare kör tre saker — HTTP, en jobbarbetare
 * och en sopare — men i M1 bara den första, plus startkontrollerna.
 */
import { humanBytes, loadConfig, ConfigError } from "./config.js";
import { checkStorage, warnIfSuspiciousMount, StartupError } from "./startup.js";
import { writeArkivformat } from "./arkivformat.js";
import { buildApp } from "./app.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  const config = loadConfig();

  // Ordningen är avsiktlig: disken kontrolleras före allt annat, och en server som
  // inte får plats startar inte alls. Bilderna är oåterkalleliga; nedtid är inte det.
  const report = await checkStorage(config);
  const app = await buildApp(config);
  app.log.info(
    {
      dataDir: report.data.path,
      mount: report.data.mount,
      filesystem: report.data.filesystem,
      free: humanBytes(report.data.freeBytes),
      total: humanBytes(report.data.totalBytes),
      minFree: humanBytes(config.minFreeBytes),
      backupDir: config.backupDir,
    },
    `receipt-trackr ${VERSION} — arkivet ligger på ${report.data.mount ?? "okänd monteringspunkt"}`,
  );
  const warning = warnIfSuspiciousMount(report);
  if (warning) app.log.warn(warning);

  const arkivformat = await writeArkivformat(config.dataDir);
  app.log.info({ file: arkivformat }, "arkivformatet beskrivet i arkivet (krav 55)");

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      app.log.info(`${signal} — stänger av`);
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

try {
  await main();
} catch (error) {
  // Konfigurations- och startfel ska läsas av en människa vid maskinen, inte tolkas
  // ur en stack trace i en containerlogg.
  if (error instanceof ConfigError || error instanceof StartupError) {
    console.error(`\nreceipt-trackr startar inte:\n\n  ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
