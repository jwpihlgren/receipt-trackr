/**
 * Hämtar OCR-modellerna vid *bygget*, inte i drift.
 *
 * Biblioteket hämtar dem annars från Hugging Face första gången någon trycker på
 * tolka. Det duger inte här av två skäl: burken ska fungera utan internet, och en
 * modellfil som laddas ner i drift är en tyst beroendekedja till någon annans server
 * — den dagen den flyttar eller försvinner slutar tolkningen fungera, långt efter att
 * någon minns varför.
 *
 * Filerna hamnar i web/public/modeller och följer med i imagen. De ligger inte i git:
 * det är tiotals megabyte binärer som går att hämta igen, och ett arkiv ska bära
 * kvitton, inte modellvikter.
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HÄR = dirname(fileURLToPath(import.meta.url));
const MÅL = join(HÄR, "..", "web", "public", "modeller");
const BAS = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main";

/** Nivåerna M0 mätte. `medium` uteslöts på ~28 s per bild och hämtas inte. */
const FILER = [
  "detection/ort/PP-OCRv6_tiny_det.ort",
  "recognition/ort/PP-OCRv6_tiny_rec.ort",
  "recognition/ppocrv6_tiny_dict.txt",
  "detection/ort/PP-OCRv6_small_det.ort",
  "recognition/ort/PP-OCRv6_small_rec.ort",
  "recognition/ppocrv6_dict.txt",
];

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function hämta(relativ) {
  const mål = join(MÅL, relativ);
  const finns = await stat(mål).catch(() => null);
  if (finns?.size) {
    console.log(`  finns redan  ${relativ} (${mb(finns.size)})`);
    return finns.size;
  }
  const svar = await fetch(`${BAS}/${relativ}`);
  if (!svar.ok) throw new Error(`${relativ}: ${svar.status} ${svar.statusText}`);
  const bytes = Buffer.from(await svar.arrayBuffer());
  await mkdir(dirname(mål), { recursive: true });
  await writeFile(mål, bytes);
  console.log(`  hämtad       ${relativ} (${mb(bytes.byteLength)})`);
  return bytes.byteLength;
}

let totalt = 0;
console.log(`Hämtar OCR-modeller till ${MÅL}`);
for (const fil of FILER) totalt += await hämta(fil);
console.log(`Klart — ${mb(totalt)} totalt.`);
