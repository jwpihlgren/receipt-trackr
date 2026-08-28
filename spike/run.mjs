/**
 * M0 — spike. Measures PP-OCRv6 tiers against real receipts on the target hardware.
 *
 * Answers four questions, and nothing else:
 *   1. Does the pipeline read this material at all — and if not, does it fail in
 *      detection (no boxes) or in recognition (boxes, but no text)?
 *   2. Which model tier and input resolution is worth its runtime on this material?
 *   3. Does per-line confidence come out, and does it vary usefully?
 *   4. What is sustained throughput once the fanless board has warmed up?
 *
 * Not production code. Nothing here is meant to survive into the server.
 */
import { PaddleOcrService, V6_TINY_MODEL, V6_SMALL_MODEL, V6_MEDIUM_MODEL } from "ppu-paddle-ocr";
import sharp from "sharp";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

// Blekt termopapper och färska kvitton mäts var för sig — en sammanslagen siffra
// ger falskt underkänt. Därför är både urval och utkatalog flaggor.
const SAMPLES = args.samples ?? "./samples";
const OUT = args.out ?? "./out";

const TIERS = {
  tiny: V6_TINY_MODEL,
  small: V6_SMALL_MODEL,
  medium: V6_MEDIUM_MODEL,
};

const tiers = (args.tiers ?? "tiny,small").split(",").filter((t) => TIERS[t]);
const variants = (args.variants ?? "raw,clahe").split(",");
// Nedskalning före OCR är en riktig produktionsparameter, inte en detalj: den
// ändrar både lästid och hur detektorn styckar sidan. Därför en egen axel.
const widths = (args.widths ?? "1600,full").split(",").map((w) => (w === "full" ? 0 : Number(w)));
const threads = Number(args.threads ?? 2);
const sustainedMinutes = Number(args.sustained ?? 0);
const saveCrops = Boolean(args.crops);

/** EXIF-rotation alltid; resten är varianten under test. */
async function preprocess(buf, variant, width) {
  let img = sharp(buf).rotate();
  if (width) img = img.resize({ width, fit: "inside", withoutEnlargement: true });
  if (variant === "raw") return img.jpeg({ quality: 95 }).toBuffer();
  // clahe: lokal kontrast är där blekt termopapper har mest att hämta
  return img.greyscale().clahe({ width: 64, height: 64, maxSlope: 3 }).jpeg({ quality: 95 }).toBuffer();
}

const toArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

const AMOUNT = /\d{1,3}(?:[ .]\d{3})*[,.]\d{2}/;
const TOTAL_CUE = /(att\s*betala|totalt|total|summa|att\s*erl[aä]gga)/i;

/**
 * PP-OCR reads uppercase O as zero on receipt fonts ("T0TALT", "0rg.nr"), and
 * the same class of confusion hits 1/I and 5/S. Cue words must be matched after
 * folding these back, or the measurement reports a miss that is really a hit.
 */
function foldConfusables(text) {
  return text.replace(/[A-ZÅÄÖ0-9]{3,}/g, (word) =>
    word.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B"),
  );
}
const DIACRITIC = /[åäöÅÄÖ]/;

/** Cheap proxy for "will field extraction have anything to work with" — not the real extractor. */
function probeFields(items) {
  const text = items.map((r) => r.text).join("\n");
  const cueLine = items.findIndex((r) => TOTAL_CUE.test(foldConfusables(r.text)));
  const totalNearCue = cueLine >= 0 && items.slice(cueLine, cueLine + 3).some((r) => AMOUNT.test(r.text));
  return {
    anyAmount: AMOUNT.test(text),
    totalCue: cueLine >= 0,
    totalNearCue,
    diacritic: DIACRITIC.test(text),
    date: /\b(20\d{2}[-/ ]\d{2}[-/ ]\d{2}|\d{2}[-/.]\d{2}[-/.]\d{2,4})\b/.test(text),
  };
}

function stats(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: +s[0].toFixed(3),
    p10: +at(0.1).toFixed(3),
    median: +at(0.5).toFixed(3),
    p90: +at(0.9).toFixed(3),
    max: +s[s.length - 1].toFixed(3),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
  };
}

async function loadSamples() {
  let files;
  try {
    files = await readdir(SAMPLES);
  } catch {
    throw new Error(`Katalogen ${SAMPLES}/ saknas.`);
  }
  const imgs = files.filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).sort();
  if (!imgs.length) {
    throw new Error(
      `Inga bilder i ${SAMPLES}/. Lägg 20 riktiga kvittobilder där — helst en blandning ` +
        `av blekt termopapper ur högen och färska kvitton, så att de går att jämföra var för sig.`,
    );
  }
  return Promise.all(imgs.map(async (f) => ({ name: f, buf: await readFile(join(SAMPLES, f)) })));
}

async function makeService(tier) {
  const service = new PaddleOcrService({
    model: TIERS[tier],
    // Biblioteket kastar som standard allt under 0.5 i konfidens. Det är rimligt
    // för en app, men förstör precis den mätning spiken finns för: en fördelning
    // som är avhuggen nedtill kan aldrig bära en tröskel.
    recognition: { minimumConfidence: 0 },
    session: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  });
  await service.initialize();
  return service;
}

async function runPass(service, samples, variant, width, { collectText, tier, label } = {}) {
  const perImage = [];
  const pooledConfidence = [];
  for (const { name, buf } of samples) {
    const input = await preprocess(buf, variant, width);
    const meta = await sharp(input).metadata();
    const ab = toArrayBuffer(input);

    // Detektion mäts separat från igenkänning. Utan den uppdelningen går det inte
    // att skilja "hittade ingen text" från "hittade text men kunde inte läsa den",
    // och det är två helt olika fel med helt olika åtgärder.
    const tDet = performance.now();
    const det = await service.detect(ab, saveCrops ? { crop: false, saveCropsTo: join(OUT, "crops", `${label}__${basename(name, extname(name))}`) } : undefined);
    const detMs = performance.now() - tDet;

    const t0 = performance.now();
    const res = await service.recognize(ab, { flatten: true, noCache: true });
    const ms = performance.now() - t0;

    const all = res.results ?? [];
    const items = all.filter((r) => r.text.trim().length > 0);
    const confs = items.map((r) => r.confidence).filter((c) => Number.isFinite(c));
    pooledConfidence.push(...confs);
    perImage.push({
      image: name,
      pixels: `${meta.width}x${meta.height}`,
      detMs: +detMs.toFixed(1),
      ms: +ms.toFixed(1),
      boxes: det.boxes.length,
      lines: items.length,
      emptyBoxes: all.length - items.length,
      chars: items.reduce((s, r) => s + r.text.trim().length, 0),
      confidence: stats(confs),
      fields: probeFields(items),
    });
    if (collectText) {
      await writeFile(
        join(OUT, "text", `${label}__${basename(name, extname(name))}.txt`),
        [`# ${name} ${meta.width}x${meta.height} — ${det.boxes.length} rutor, ${items.length} lästa rader`, ""]
          .concat(all.map((r) => `${r.text || "(tom)"} [${r.confidence.toFixed(3)}]`))
          .join("\n"),
      );
    }
  }
  return { perImage, pooledConfidence };
}

function summarise(perImage, pooledConfidence) {
  const share = (pred) => +(perImage.filter(pred).length / perImage.length).toFixed(2);
  return {
    images: perImage.length,
    msPerImage: stats(perImage.map((r) => r.ms)),
    detMsPerImage: stats(perImage.map((r) => r.detMs)),
    boxesPerImage: stats(perImage.map((r) => r.boxes)),
    linesPerImage: stats(perImage.map((r) => r.lines)),
    charsPerImage: stats(perImage.map((r) => r.chars)),
    pooledLineConfidence: stats(pooledConfidence),
    shareNoBoxes: share((r) => r.boxes === 0),
    shareNoText: share((r) => r.chars === 0),
    shareBarelyRead: share((r) => r.chars > 0 && r.chars < 40),
    shareWithAmount: share((r) => r.fields.anyAmount),
    shareWithTotalCue: share((r) => r.fields.totalCue),
    shareWithTotalNearCue: share((r) => r.fields.totalNearCue),
    shareWithDate: share((r) => r.fields.date),
    shareWithDiacritic: share((r) => r.fields.diacritic),
  };
}

/** Sustained load: the number that matters on a fanless board. */
async function runSustained(service, samples, variant, width, minutes) {
  const deadline = Date.now() + minutes * 60_000;
  const buckets = [];
  const started = Date.now();
  let i = 0;
  while (Date.now() < deadline) {
    const { buf } = samples[i++ % samples.length];
    const input = await preprocess(buf, variant, width);
    const t0 = performance.now();
    await service.recognize(toArrayBuffer(input), { flatten: true, noCache: true });
    const ms = performance.now() - t0;
    const minute = Math.floor((Date.now() - started) / 60_000);
    (buckets[minute] ??= []).push(ms);
  }
  const perMinute = buckets.map((b, m) => ({ minute: m, images: b.length, meanMs: +stats(b).mean }));
  const head = perMinute.slice(0, 5);
  const tail = perMinute.slice(-5);
  const mean = (xs) => xs.reduce((a, b) => a + b.meanMs, 0) / xs.length;
  return {
    minutes,
    perMinute,
    firstFiveMinMeanMs: +mean(head).toFixed(1),
    lastFiveMinMeanMs: +mean(tail).toFixed(1),
    throttleFactor: +(mean(tail) / mean(head)).toFixed(2),
    totalImages: perMinute.reduce((a, b) => a + b.images, 0),
  };
}

const wname = (w) => (w ? String(w) : "full");

function report(results, sustained) {
  const l = [];
  l.push("# M0 — spikeresultat\n");
  l.push(`Kört ${new Date().toISOString()} · ${threads} ONNX-trådar · ${process.arch} · urval: ${SAMPLES}\n`);

  // Läser den överhuvudtaget? Allt annat är meningslöst innan den frågan är besvarad.
  l.push("## Läser den kvittot alls?\n");
  l.push("| Nivå | Variant | Bredd | Bilder utan rutor | Bilder utan text | Knappt läst (<40 tecken) | Tecken/bild (median) |");
  l.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const s = r.summary;
    l.push(
      `| ${r.tier} | ${r.variant} | ${wname(r.width)} | ${s.shareNoBoxes} | ${s.shareNoText} | ` +
        `${s.shareBarelyRead} | ${s.charsPerImage.median} |`,
    );
  }
  const worst = results.reduce((a, b) => (a.summary.charsPerImage.median >= b.summary.charsPerImage.median ? a : b));
  const w = worst.summary;
  l.push("");
  if (w.charsPerImage.median < 40) {
    l.push(
      `**Ingen inställning läser materialet.** Bästa försöket (${worst.tier}/${worst.variant}/${wname(worst.width)}) ` +
        `ger ${w.charsPerImage.median} tecken per bild. ` +
        (w.shareNoBoxes > 0.5
          ? `Felet ligger i **detektionen**: ${(w.shareNoBoxes * 100).toFixed(0)} % av bilderna ger noll textrutor. ` +
            `Titta på bilderna själv — beskärning, skärpa och att kvittot fyller bilden är det som avgör här, inte modellnivån.`
          : `Detektionen hittar rutor men igenkänningen får inte ut text ur dem. Kör om med \`--crops\` och titta i \`crops/\`: ` +
            `står texten upp och ner, är den avskuren, eller är kontrasten borta?`),
    );
  } else {
    l.push(`Bästa inställning: **${worst.tier}/${worst.variant}/${wname(worst.width)}**, ${w.charsPerImage.median} tecken per bild.`);
  }

  l.push("\n## Genomströmning och konfidens\n");
  l.push("| Nivå | Variant | Bredd | ms/bild (median) | ms p90 | varav detektion | Rutor | Lästa rader | Radkonfidens median | p10 |");
  l.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const s = r.summary;
    l.push(
      `| ${r.tier} | ${r.variant} | ${wname(r.width)} | ${s.msPerImage.median} | ${s.msPerImage.p90} | ` +
        `${s.detMsPerImage.median} | ${s.boxesPerImage.median} | ${s.linesPerImage.median} | ` +
        `${s.pooledLineConfidence?.median ?? "—"} | ${s.pooledLineConfidence?.p10 ?? "—"} |`,
    );
  }

  l.push("\n## Vad som gick att hitta på kvittot\n");
  l.push("| Nivå | Variant | Bredd | Belopp | Totalord | Belopp nära totalord | Datum | åäö |");
  l.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const s = r.summary;
    l.push(
      `| ${r.tier} | ${r.variant} | ${wname(r.width)} | ${s.shareWithAmount} | ${s.shareWithTotalCue} | ` +
        `${s.shareWithTotalNearCue} | ${s.shareWithDate} | ${s.shareWithDiacritic} |`,
    );
  }

  const spread = results.map((r) => r.summary.pooledLineConfidence).filter(Boolean);
  const pooledN = Math.max(0, ...spread.map((s) => s.n));
  l.push("\n## Duger konfidensmåttet?\n");
  const flat = spread.length ? Math.max(...spread.map((s) => s.p90 - s.p10)) : 0;
  l.push(
    pooledN < 200
      ? `För få rader (${pooledN}) för att uttala sig om spridningen. Det betyder inte att måttet är dåligt — ` +
          `det betyder att läsningen ovan misslyckades, eller att urvalet är för litet.`
      : flat < 0.05
      ? `**Varning:** spridningen mellan p10 och p90 är ${flat.toFixed(3)}. Ett mått som inte ` +
          `varierar kan inte bära en tröskel — då är krav 11 och 12 inte lösbara med det här måttet.`
      : `Spridningen p10–p90 är upp till ${flat.toFixed(3)}, alltså ett mått som faktiskt skiljer ` +
          `kvitton åt. Det är en förutsättning för tröskelarbetet i Steg 2, inte ett bevis för att ` +
          `måttet är kalibrerat — det avgörs först av granskningsurvalet.`,
  );

  if (sustained) {
    l.push("\n## Uthållig last (passiv kylning)\n");
    l.push(`Körd i ${sustained.minutes} minuter, ${sustained.totalImages} bilder.`);
    l.push(`Första fem minuterna: ${sustained.firstFiveMinMeanMs} ms/bild.`);
    l.push(`Sista fem minuterna: ${sustained.lastFiveMinMeanMs} ms/bild.`);
    l.push(`**Strypfaktor: ${sustained.throttleFactor}×.**`);
    const perReceipt = (sustained.lastFiveMinMeanMs * 2) / 1000;
    l.push(
      `\nMed två segment per kvitto ger det ~${perReceipt.toFixed(1)} s/kvitto i varmt tillstånd, ` +
        `alltså ~${((perReceipt * 10000) / 3600).toFixed(1)} timmar för tiotusen kvitton.`,
    );
  }
  return l.join("\n") + "\n";
}

const samples = await loadSamples();
await mkdir(join(OUT, "text"), { recursive: true });
console.log(
  `${samples.length} bilder · nivåer: ${tiers.join(", ")} · varianter: ${variants.join(", ")} · bredder: ${widths.map(wname).join(", ")}`,
);

const results = [];
let sustained = null;
for (const tier of tiers) {
  const service = await makeService(tier);
  // warm-up: first call pays model load and allocation, and must not pollute the timing
  await runPass(service, samples.slice(0, 1), variants[0], widths[0], { label: "warmup" });
  for (const variant of variants) {
    for (const width of widths) {
      const label = `${tier}__${variant}__${wname(width)}`;
      process.stdout.write(`  ${tier}/${variant}/${wname(width)} ... `);
      const { perImage, pooledConfidence } = await runPass(service, samples, variant, width, {
        collectText: true,
        tier,
        label,
      });
      const summary = summarise(perImage, pooledConfidence);
      results.push({ tier, variant, width, summary, perImage });
      console.log(
        `${summary.msPerImage.median} ms/bild · ${summary.charsPerImage.median} tecken · ` +
          `${summary.boxesPerImage.median} rutor · konfidens ${summary.pooledLineConfidence?.median ?? "—"}`,
      );
    }
  }
  if (sustainedMinutes && tier === tiers[tiers.length - 1]) {
    console.log(`  uthållighetstest ${sustainedMinutes} min ...`);
    sustained = await runSustained(service, samples, variants[0], widths[0], sustainedMinutes);
    console.log(`  strypfaktor ${sustained.throttleFactor}×`);
  }
  await service.destroy();
}

await writeFile(join(OUT, "summary.json"), JSON.stringify({ threads, results, sustained }, null, 2));
const md = report(results, sustained);
await writeFile(join(OUT, "summary.md"), md);
console.log(`\n${md}`);
