/**
 * `reindex` som eget kommando: `docker compose exec app node server/dist/reindex.js`.
 * Det är återställningsvägen när indexet tappats bort eller schemat ändrats — och
 * eftersom indexet är härlett är det aldrig något som går förlorat.
 */
import { loadConfig } from "./config.js";
import { Archive } from "./store/archive.js";

const config = loadConfig();
const archive = Archive.open(config.dataDir);
try {
  const started = Date.now();
  const { indexed, skipped } = await archive.reindex();
  console.log(`Indexerade ${indexed} kvitton på ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  if (skipped.length) {
    console.error(`\n${skipped.length} sidecar-filer gick inte att läsa:`);
    for (const file of skipped) console.error(`  ${file}`);
    process.exitCode = 1;
  }
} finally {
  archive.close();
}
