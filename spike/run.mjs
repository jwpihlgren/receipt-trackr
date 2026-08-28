/**
 * M0 — spike. Measures PP-OCRv6 tiers against real receipts on the target hardware.
 *
 * Answers four questions, and nothing else:
 *   1. Does the pipeline read this material at all — and if not, does it fail in
 *      detection (no boxes), in recognition (boxes, but no text), or in orientation
 *      (boxes and text, but one character per line because the page lies sideways)?
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

// Material av olika slag — vikta kvitton, blekt termopapper, färska kvitton — mäts var
// för sig. En sammanslagen siffra ger falskt underkänt. Därför är både urval och
// utkatalog flaggor.
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
// Orienteringen är en mätaxel, inte en självklarhet. `exif` är produktionsvägen:
// sharp läser Orientation-taggen och rätar upp bilden. Saknas taggen — telefonen
// sparade sensorns liggande bild utan att märka den, eller så tvättade
// överföringen bort metadatan — hjälper ingen automatik, och då är 90/180/270
// sättet att mäta vad orienteringen kostade i stället för att gissa.
// `auto` är produktionsregeln: vridningen avgörs per bild i stället för att
// antas, och kan därför inte mätas mot en annan vridning i samma körning.
const rotations = (args.rotations ?? "exif")
  .split(",")
  .map((r) => (r === "exif" ? 0 : r === "auto" ? "auto" : Number(r)));
if (rotations.includes("auto") && rotations.length > 1) {
  throw new Error("--rotations=auto avgör vridningen per bild och körs ensam.");
}
if (rotations.some((r) => r !== "auto" && ![0, 90, 180, 270].includes(r))) {
  throw new Error("--rotations tar exif, auto, 90, 180 eller 270, kommaseparerat.");
}
/** Bild → vald vridning. Fylls av calibrateOrientation() när `auto` är påslaget. */
let calibration = null;
const threads = Number(args.threads ?? 2);
const sustainedMinutes = Number(args.sustained ?? 0);
const saveCrops = Boolean(args.crops);
// Biblioteket vrider som standard varje beskuren ruta som är klart högre än bred
// 90° moturs. På en bild som ligger ned rätas raderna därmed upp medan varje
// tecken blir liggande, och igenkänningen svarar med ett tecken per rad i stället
// för med ingenting. Flaggan finns för att kunna se det felet oskymt.
const rotateVerticalCrops = String(args.vertcrops ?? "true") !== "false";

/**
 * EXIF-orienteringen sätts på indatasteget (`autoOrient`), inte som ett led i
 * kedjan: sharp rätar upp bilden när den avkodas, alltså före rotation, skalning
 * och gråskala, oavsett i vilken ordning anropen nedan står. Resten är varianten
 * under test.
 */
async function preprocess(buf, variant, width, rotation = 0) {
  let img = sharp(buf, { autoOrient: true });
  if (rotation) img = img.rotate(rotation);
  if (width) img = img.resize({ width, fit: "inside", withoutEnlargement: true });
  if (variant === "raw") return img.jpeg({ quality: 95 }).toBuffer();
  // clahe: lokal kontrast, som blekt termopapper har mest att hämta av. Mot vikta men
  // opåverkade kvitton är den snarare en kontroll än en förväntad vinst.
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
      `Inga bilder i ${SAMPLES}/. Lägg minst 20 riktiga kvittobilder där. Håll material av ` +
        `olika slag i egna kataloger — vikta, blekta, färska — så att de mäts var för sig.`,
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
    recognition: { minimumConfidence: 0, rotateVerticalCrops },
    session: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  });
  await service.initialize();
  return service;
}

/**
 * Orienteringen är en egenskap hos filen, inte hos modellnivån, och avgörs därför
 * en gång per bild före mätmatrisen i stället för om och om igen i varje pass.
 * Två steg: andelen textrutor som är högre än breda säger *om* sidan ligger ned,
 * och en provläsning åt båda hållen säger *åt vilket håll* — 90° och 270° går inte
 * att skilja på formen, bara på vad som faktiskt går att läsa.
 */
async function calibrateOrientation(samples, width) {
  const service = await makeService("tiny");
  const calibrated = new Map();
  try {
    for (const { name, buf } of samples) {
      const t0 = performance.now();
      const det = await service.detect(toArrayBuffer(await preprocess(buf, "raw", width, 0)));
      const tallShare = det.boxes.length
        ? det.boxes.filter((b) => b.height > b.width).length / det.boxes.length
        : 0;
      const entry = { tallShare: +tallShare.toFixed(2), rotation: 0, confidence: null, uncertain: false };
      if (tallShare > 0.5) {
        const scores = [];
        for (const candidate of [90, 270]) {
          const input = await preprocess(buf, "raw", width, candidate);
          const res = await service.recognize(toArrayBuffer(input), { flatten: true, noCache: true });
          const confs = (res.results ?? [])
            .filter((r) => r.text.trim().length > 0)
            .map((r) => r.confidence)
            .filter((c) => Number.isFinite(c));
          scores.push({ candidate, confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0 });
        }
        const best = scores.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
        entry.rotation = best.candidate;
        entry.confidence = +best.confidence.toFixed(3);
        // Två svaga kandidater betyder att valet inte vilar på någonting. Bilden är
        // då inte automatiskt uppräteligt, och det ska synas i stället för döljas.
        entry.uncertain = best.confidence < 0.5;
      }
      entry.ms = +(performance.now() - t0).toFixed(1);
      calibrated.set(name, entry);
    }
  } finally {
    await service.destroy();
  }
  return calibrated;
}

async function runPass(service, samples, variant, width, rotation, { collectText, tier, label } = {}) {
  const perImage = [];
  const pooledConfidence = [];
  for (const { name, buf } of samples) {
    // Källans mått och Orientation-tagg läses före förbehandlingen. Det är enda
    // sättet att skilja "bilden saknar tagg och ligger ned på disken" från
    // "taggen fanns och lästes" — utan den skillnaden går ett orienteringsfel
    // inte att felsöka, bara att gissa om.
    const src = await sharp(buf).metadata();
    const rot = rotation === "auto" ? calibration.get(name)?.rotation ?? 0 : rotation;
    const input = await preprocess(buf, variant, width, rot);
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
    const chars = items.reduce((s, r) => s + r.text.trim().length, 0);
    perImage.push({
      image: name,
      rotation: rot,
      source: `${src.width}x${src.height}`,
      // sharp utelämnar fältet när taggen saknas; 1 betyder "upprätt, vrid inte".
      exifOrientation: src.orientation ?? null,
      pixels: `${meta.width}x${meta.height}`,
      upright: meta.height >= meta.width,
      // En textruta som är högre än bred är en rad som står på högkant. Måttet är
      // modellfritt och pekar på bilden, inte på nivån.
      tallBoxShare: det.boxes.length
        ? +(det.boxes.filter((b) => b.height > b.width).length / det.boxes.length).toFixed(2)
        : 0,
      detMs: +detMs.toFixed(1),
      ms: +ms.toFixed(1),
      boxes: det.boxes.length,
      lines: items.length,
      emptyBoxes: all.length - items.length,
      chars,
      // Ungefär ett tecken per läst rad är signaturen för tecken som ligger ned:
      // raden hittas, ramas in och läses — och ger ändå bara ett tecken ifrån sig.
      charsPerLine: items.length ? +(chars / items.length).toFixed(1) : 0,
      confidence: stats(confs),
      fields: probeFields(items),
    });
    if (collectText) {
      await writeFile(
        join(OUT, "text", `${label}__${basename(name, extname(name))}.txt`),
        [
          `# ${name} ${src.width}x${src.height} exif=${src.orientation ?? "saknas"} → ` +
            `${meta.width}x${meta.height} — ${det.boxes.length} rutor, ${items.length} lästa rader`,
          "",
        ]
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
    charsPerLine: stats(perImage.map((r) => r.charsPerLine)),
    tallBoxShare: stats(perImage.map((r) => r.tallBoxShare)),
    shareLandscape: share((r) => !r.upright),
    // Ingen tagg, eller taggen 1 ("upprätt"), betyder båda att EXIF inte vrider
    // något. Ligger bilden ändå ned är det pixlarna som är vridna, inte metadatan.
    shareNoExifRotation: share((r) => !r.exifOrientation || r.exifOrientation === 1),
    // Rader hittas och läses, men ger ~ett tecken var. Se kommentaren vid charsPerLine.
    shareSideways: share((r) => r.lines >= 5 && r.charsPerLine < 2.5),
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
async function runSustained(service, samples, variant, width, rotation, minutes) {
  const deadline = Date.now() + minutes * 60_000;
  const buckets = [];
  const started = Date.now();
  let i = 0;
  while (Date.now() < deadline) {
    const { name, buf } = samples[i++ % samples.length];
    const rot = rotation === "auto" ? calibration.get(name)?.rotation ?? 0 : rotation;
    const input = await preprocess(buf, variant, width, rot);
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
const rname = (r) => (r === "auto" ? "auto" : r ? `${r}°` : "exif");
/** Nivå/variant/bredd/vridning i en cell — samma ordning som etiketterna i text/. */
const axes = (r) => `${r.tier} | ${r.variant} | ${wname(r.width)} | ${rname(r.rotation)}`;

function report(results, sustained) {
  const l = [];
  l.push("# M0 — spikeresultat\n");
  l.push(`Kört ${new Date().toISOString()} · ${threads} ONNX-trådar · ${process.arch} · urval: ${SAMPLES}\n`);

  // Läser den överhuvudtaget? Allt annat är meningslöst innan den frågan är besvarad.
  l.push("## Läser den kvittot alls?\n");
  l.push(
    "| Nivå | Variant | Bredd | Vridning | Bilder utan rutor | Bilder utan text | Knappt läst (<40 tecken) | Tecken/bild (median) |",
  );
  l.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const s = r.summary;
    l.push(
      `| ${axes(r)} | ${s.shareNoBoxes} | ${s.shareNoText} | ` +
        `${s.shareBarelyRead} | ${s.charsPerImage.median} |`,
    );
  }
  const worst = results.reduce((a, b) => (a.summary.charsPerImage.median >= b.summary.charsPerImage.median ? a : b));
  const w = worst.summary;
  l.push("");
  if (w.charsPerImage.median < 40) {
    l.push(
      `**Ingen inställning läser materialet.** Bästa försöket (${worst.tier}/${worst.variant}/${wname(worst.width)}/${rname(worst.rotation)}) ` +
        `ger ${w.charsPerImage.median} tecken per bild. ` +
        (w.shareSideways > 0.2
          ? `Felet ligger i **orienteringen**, inte i modellen: ${(w.shareSideways * 100).toFixed(0)} % av bilderna ` +
            `ger ungefär ett tecken per läst rad. Se orienteringstabellen nedan innan något annat ändras.`
          : w.shareNoBoxes > 0.5
          ? `Felet ligger i **detektionen**: ${(w.shareNoBoxes * 100).toFixed(0)} % av bilderna ger noll textrutor. ` +
            `Titta på bilderna själv — beskärning, skärpa och att kvittot fyller bilden är det som avgör här, inte modellnivån.`
          : `Detektionen hittar rutor men igenkänningen får inte ut text ur dem. Kör om med \`--crops\` och titta i \`crops/\`: ` +
            `står texten upp och ner, är den avskuren, eller är kontrasten borta?`),
    );
  } else {
    l.push(
      `Bästa inställning: **${worst.tier}/${worst.variant}/${wname(worst.width)}/${rname(worst.rotation)}**, ` +
        `${w.charsPerImage.median} tecken per bild.`,
    );
  }

  // Orienteringen står näst i rapporten, före hastighet och konfidens, därför att
  // den ogiltigförklarar allt under sig när den är fel: en bild som ligger ned ger
  // textrutor på högkant, och en igenkänning byggd för vågrät text svarar med ett
  // tecken per rad. Det ser ut som ett modellfel och är det inte.
  l.push("\n## Orientering\n");
  l.push(
    "| Nivå | Variant | Bredd | Vridning | Liggande efter förbehandling | Utan EXIF-vridning | Höga rutor (median) | Tecken/rad (median) | Misstänkt sidledes |",
  );
  l.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const s = r.summary;
    l.push(
      `| ${axes(r)} | ${s.shareLandscape} | ${s.shareNoExifRotation} | ${s.tallBoxShare.median} | ` +
        `${s.charsPerLine.median} | ${s.shareSideways} |`,
    );
  }
  // Domen ställs på exif-raderna, alltså på produktionsvägen. Rader som mätts med
  // påtvingad vridning är avsiktligt vridna och skulle annars döma ut en körning
  // som var frisk.
  const baseline = results.filter((r) => r.rotation === 0 || r.rotation === "auto");
  const rows = baseline.length ? baseline : results;
  // Rådet ska peka på nästa steg, inte på det som just kördes.
  const advice = rotations.includes("auto")
    ? " Automatisk uppräting är påslagen — se avsnittet nedan för vad den valde och vad den kostade."
    : rotations.length > 1
    ? " Vinnaren står i tabellen ovan. Kör mätserien med `--rotations=auto` så avgörs vridningen per" +
      " bild i stället för att antas — bilder som redan står upp får inte vridas."
    : " Kör om med `--rotations=auto`, som avgör vridningen per bild.";
  const sideways = Math.max(...rows.map((r) => r.summary.shareSideways));
  const landscape = Math.max(...rows.map((r) => r.summary.shareLandscape));
  const noExif = Math.max(...rows.map((r) => r.summary.shareNoExifRotation));
  l.push("");
  if (rotations.length > 1) {
    const best = (rot) =>
      Math.max(...results.filter((r) => r.rotation === rot).map((r) => r.summary.charsPerImage.median));
    l.push(
      `Bästa läsning per vridning: ${rotations.map((rot) => `${rname(rot)} ${best(rot)}`).join(", ")} ` +
        `tecken per bild.\n`,
    );
  }
  if (sideways > 0.2) {
    l.push(
      `**${(sideways * 100).toFixed(0)} % av bilderna läses ett tecken i taget.** Det är text som ligger ` +
        `på sidan, inte en modell som är för liten — och ${(landscape * 100).toFixed(0)} % av bilderna är ` +
        `liggande *efter* förbehandlingen, alltså efter att EXIF-orienteringen tillämpats.` +
        (noExif > 0.5
          ? ` ${(noExif * 100).toFixed(0)} % av dem saknar dessutom EXIF-vridning: kameran sparade sensorns ` +
            `liggande bild utan tagg, eller så tvättade överföringen bort den.${advice}`
          : ` Taggen finns och tillämpas, så bilderna är alltså faktiskt tagna liggande.${advice}`),
    );
  } else if (landscape > 0.5) {
    l.push(
      `${(landscape * 100).toFixed(0)} % av bilderna är liggande efter förbehandlingen, men läsningen ser ` +
        `inte sidledes ut. Kvitton fotograferade liggande med gott om marginal är fullt läsbara — notera ` +
        `bara att den nedskalade bredden då går till marginal i stället för till text.`,
    );
  } else {
    l.push(
      "Läsningen är radvis och inte teckenvis, och andelen liggande bilder är låg. Orienteringen är " +
        "inte felkällan här.",
    );
  }

  if (calibration) {
    const calibRows = [...calibration.values()];
    const share = (pred) => +(calibRows.filter(pred).length / calibRows.length).toFixed(2);
    const cost = stats(calibRows.map((r) => r.ms));
    l.push("\n## Automatisk uppräting\n");
    l.push("Avgjord en gång per bild med `tiny`, före mätmatrisen. Vald vridning:\n");
    l.push("| Vridning | Andel bilder |");
    l.push("| --- | --- |");
    for (const rot of [0, 90, 270]) {
      const part = share((r) => r.rotation === rot);
      if (part) l.push(`| ${rname(rot)} | ${part} |`);
    }
    l.push("");
    l.push(`Beslutet kostar ${cost.median} ms per bild i median, ${cost.p90} p90 — en gång per uppladdning.`);
    const uncertain = share((r) => r.uncertain);
    if (uncertain) {
      l.push(
        `\n**${(uncertain * 100).toFixed(0)} % av bilderna gav svaga kandidater åt båda hållen** ` +
          `(under 0,5 i medelkonfidens). För dem vilar valet inte på något, och de hör till ` +
          `granskningskön oavsett vad läsningen sedan ger.`,
      );
    }
  }

  l.push("\n## Genomströmning och konfidens\n");
  l.push(
    "| Nivå | Variant | Bredd | Vridning | ms/bild (median) | ms p90 | varav detektion | Rutor | Lästa rader | Radkonfidens median | p10 |",
  );
  l.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const s = r.summary;
    l.push(
      `| ${axes(r)} | ${s.msPerImage.median} | ${s.msPerImage.p90} | ` +
        `${s.detMsPerImage.median} | ${s.boxesPerImage.median} | ${s.linesPerImage.median} | ` +
        `${s.pooledLineConfidence?.median ?? "—"} | ${s.pooledLineConfidence?.p10 ?? "—"} |`,
    );
  }

  l.push("\n## Vad som gick att hitta på kvittot\n");
  l.push("| Nivå | Variant | Bredd | Vridning | Belopp | Totalord | Belopp nära totalord | Datum | åäö |");
  l.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const s = r.summary;
    l.push(
      `| ${axes(r)} | ${s.shareWithAmount} | ${s.shareWithTotalCue} | ` +
        `${s.shareWithTotalNearCue} | ${s.shareWithDate} | ${s.shareWithDiacritic} |`,
    );
  }

  // Samma sak som orienteringsdomen: spridningen ska mätas på produktionsvägen.
  // En avsiktligt vriden rad läser skräp, och skräp har gott om spridning.
  const spread = rows.map((r) => r.summary.pooledLineConfidence).filter(Boolean);
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
  `${samples.length} bilder · nivåer: ${tiers.join(", ")} · varianter: ${variants.join(", ")} · ` +
    `bredder: ${widths.map(wname).join(", ")} · vridning: ${rotations.map(rname).join(", ")}` +
    (rotateVerticalCrops ? "" : " · vertikala beskärningar roteras inte"),
);

if (rotations.includes("auto")) {
  // Kalibreringen körs på den minsta uppmätta bredden: valet av vridning är
  // grovt nog att inte behöva full upplösning, och ska inte kosta som en mätning.
  const calibWidth = widths.filter(Boolean).sort((a, b) => a - b)[0] ?? 1600;
  process.stdout.write(`  avgör vridning per bild (tiny, ${calibWidth} px) ... `);
  calibration = await calibrateOrientation(samples, calibWidth);
  const chosen = [...calibration.values()];
  console.log(
    `${chosen.filter((c) => c.rotation).length} av ${chosen.length} bilder behöver vridas` +
      `${chosen.some((c) => c.uncertain) ? `, ${chosen.filter((c) => c.uncertain).length} osäkra` : ""}`,
  );
}

const results = [];
let sustained = null;
for (const tier of tiers) {
  const service = await makeService(tier);
  // warm-up: first call pays model load and allocation, and must not pollute the timing
  await runPass(service, samples.slice(0, 1), variants[0], widths[0], rotations[0], { label: "warmup" });
  for (const variant of variants) {
    for (const width of widths) {
      for (const rotation of rotations) {
        const label = `${tier}__${variant}__${wname(width)}__${rotation ? `rot${rotation}` : "exif"}`;
        process.stdout.write(`  ${tier}/${variant}/${wname(width)}/${rname(rotation)} ... `);
        const { perImage, pooledConfidence } = await runPass(service, samples, variant, width, rotation, {
          collectText: true,
          tier,
          label,
        });
        const summary = summarise(perImage, pooledConfidence);
        results.push({ tier, variant, width, rotation, summary, perImage });
        console.log(
          `${summary.msPerImage.median} ms/bild · ${summary.charsPerImage.median} tecken · ` +
            `${summary.charsPerLine.median} tecken/rad · ${summary.boxesPerImage.median} rutor · ` +
            `konfidens ${summary.pooledLineConfidence?.median ?? "—"}`,
        );
      }
    }
  }
  if (sustainedMinutes && tier === tiers[tiers.length - 1]) {
    console.log(`  uthållighetstest ${sustainedMinutes} min ...`);
    sustained = await runSustained(service, samples, variants[0], widths[0], rotations[0], sustainedMinutes);
    console.log(`  strypfaktor ${sustained.throttleFactor}×`);
  }
  await service.destroy();
}

await writeFile(
  join(OUT, "summary.json"),
  JSON.stringify(
    {
      threads,
      rotateVerticalCrops,
      orientation: calibration ? Object.fromEntries(calibration) : null,
      results,
      sustained,
    },
    null,
    2,
  ),
);
const md = report(results, sustained);
await writeFile(join(OUT, "summary.md"), md);
console.log(`\n${md}`);
