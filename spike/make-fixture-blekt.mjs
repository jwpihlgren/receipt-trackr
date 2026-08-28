/** Blekt termopapper, fotograferat med telefon: låg kontrast, stor bild, jpeg-brus. */
import sharp from "sharp";
const lines = [
  "COOP FORUM SEGELTORP", "Org.nr 556280-1234", "",
  "MJOLK 3% 1L               2 st    29,80",
  "KAFFE BRYGG 450G          1 st    64,90",
  "SMOR NORMALSALT           1 st    54,50",
  "AGG FRIGAENDE 12P         1 st    44,90", "",
  "TOTALT                            194,10",
  "ATT BETALA                        194,10",
  "Varav moms 12%                     20,80", "",
  "2026-03-02 17:14  Kassa 7  Kvitto 118342",
];
const W = 760, H = 80 + lines.length * 36;
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
<rect width="100%" height="100%" fill="#d9d7d2"/>
${lines.map((t,i)=>`<text x="40" y="${60+i*36}" font-family="monospace" font-size="25" fill="#9a9892">${t}</text>`).join("\n")}
</svg>`;
const paper = await sharp(Buffer.from(svg)).png().toBuffer();

// Kvittot upptar ~65 % av höjden i en 3024x4032-ram, som ett handhållet foto.
const targetW = Math.round(3024 * 0.86);
const scaled = await sharp(paper).resize({ width: targetW }).toBuffer();
const m = await sharp(scaled).metadata();
await sharp({ create: { width: 3024, height: 4032, channels: 3, background: "#6e6b66" } })
  .composite([{ input: scaled, left: Math.round((3024 - m.width) / 2), top: Math.round((4032 - m.height) / 2) }])
  .jpeg({ quality: 78 })
  .toFile("./samples/_blekt-telefonfoto.jpg");
console.log(`skrev samples/_blekt-telefonfoto.jpg (papper ${m.width}x${m.height} i 3024x4032)`);
