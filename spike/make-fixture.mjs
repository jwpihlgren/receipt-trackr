/** Generates a synthetic Swedish receipt. Validates the harness only — never a substitute for real paper. */
import sharp from "sharp";
const lines = [
  "BAUHAUS KUNGENS KURVA", "Org.nr 556280-1234", "Månskensvägen 12, Segeltorp", "",
  "KAKEL VÄGG VIT 20X40      12 st   1188,00",
  "FÄSTMASSA FLEX 20KG        2 st    598,00",
  "FOGMASSA GRÅ 5KG           1 st    189,50",
  "SKRUV ROSTFRI 4,5X60     1 pkt    129,00", "",
  "TOTALT                            2104,50",
  "ATT BETALA                        2104,50",
  "Varav moms 25%                     420,90", "",
  "2026-04-11 14:32   Kassa 3   Kvitto 004512",
];
const svg = `<svg width="720" height="${80 + lines.length * 34}" xmlns="http://www.w3.org/2000/svg">
<rect width="100%" height="100%" fill="#f2f0ec"/>
${lines.map((t, i) => `<text x="40" y="${60 + i * 34}" font-family="monospace" font-size="24" fill="#3a3a3a">${t}</text>`).join("\n")}
</svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile("./samples/_syntetiskt-kvitto.jpg");
console.log("skrev samples/_syntetiskt-kvitto.jpg");
