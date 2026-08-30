/**
 * Butiksnamn ur råtexten.
 *
 * Namnet står nästan alltid överst, men det är också där OCR:en har det svårast:
 * logotyper är stiliserade, och M5a gav `HORNBAGH`, `RORNBAGH` och `DHORN BACH` för
 * samma butik. En exakt jämförelse mot en lista hade missat alla tre.
 *
 * Därför två steg: en känd kedja matchas tolerant över hela texten, och först om ingen
 * kedja känns igen faller vi tillbaka på den första raden som ser ut som ett namn.
 * Listan är avsiktligt kort och ska växa när användaren rättar — ett kvittoarkiv för
 * ett hushåll besöker samma tjugo butiker om och om igen.
 */
import { jamforbar } from "./tecken.js";

export type Butikskandidat = { value: string; confidence: number; kand: boolean };

export const KEDJOR = [
  "ICA", "Coop", "Willys", "Hemköp", "Lidl", "Netto", "City Gross", "Matöppet",
  "Byggmax", "Hornbach", "Bauhaus", "K-Rauta", "Beijer", "Jula", "Biltema", "Clas Ohlson",
  "Systembolaget", "Apoteket", "Kronans Apotek", "Apotek Hjärtat",
  "Kjell & Company", "Elgiganten", "NetOnNet", "Media Markt",
  "Pressbyrån", "7-Eleven", "Espresso House", "Waynes Coffee",
  "Circle K", "OKQ8", "Ingo", "Preem", "Shell", "St1", "Tesla",
  "IKEA", "Rusta", "Dollarstore", "Åhléns", "Stadium", "XXL", "Intersport",
  "H&M", "Lindex", "KappAhl", "Dressmann", "Granngården", "Plantagen", "Blomsterlandet",
] as const;

/**
 * Rader som sammanfattar i stället för att namnge. Ett butiksnamn som bara förekommer
 * på en sådan rad är ett sammanträffande, inte en butik.
 */
const SUMMERINGSRAD = /\b(BRUTTO|MOMS|NETTO|SUMMA|TOTALT|MERVARDESSKATT)\b/;

/**
 * Hur många tecken som får skilja innan två namn inte längre är samma namn.
 *
 * Toleransen måste skala med längden, annars blir den absurd på korta namn: två fel i
 * `LIDL` är halva ordet, och `LILLA Kvarnbageriet` blev en Lidl-butik. Under fem tecken
 * tillåts ingen tolerans alls — `ICA`, `Coop` och `Lidl` matchas exakt eller inte alls,
 * och det är rätt: ett tre bokstävers ord som nästan stämmer stämmer inte.
 */
const tolerans = (nyckel: string): number => (nyckel.length >= 8 ? 2 : nyckel.length >= 5 ? 1 : 0);

export function utvinnButik(text: string): Butikskandidat[] {
  const rader = text.split(/\n+/).flatMap((r) => r.split(/\s{2,}/));
  const ut: Butikskandidat[] = [];

  // Kedjorna först, och över hela texten: namnet står ibland i sidfoten också, och
  // en andra förekomst är ett kvitto på den första.
  const hela = jamforbar(text);
  const topprader = rader.slice(0, 8).map(jamforbar);

  for (const kedja of KEDJOR) {
    const nyckel = jamforbar(kedja);
    const traffar = rakna(hela, nyckel);
    if (traffar > 0) {
      /**
       * `NETTO` står i momsraden `BRUTTO MOMS NETTO` på varje svenskt kvitto, och gjorde
       * Hornbach till en Netto-butik.
       *
       * Signalen är radens innehåll, inte dess position: en radposition beror på hur
       * många rader kvittot råkar ha, medan en rad med BRUTTO och MOMS på aldrig är en
       * butiksrubrik. Står namnet bara där, och bara en gång, är det inte butiken.
       */
      if (traffar === 1) {
        const raden = rader.map(jamforbar).find((r) => r.includes(nyckel));
        if (raden && SUMMERINGSRAD.test(raden)) continue;
      }
      ut.push({ value: kedja, confidence: Math.min(0.95, 0.72 + traffar * 0.08), kand: true });
      continue;
    }
    // Inte exakt — men OCR gav `HORNBAGH` för `HORNBACH`. Leta i toppen, där namnet
    // står, och tillåt några tecken fel i förhållande till namnets längd.
    const tak = tolerans(nyckel);
    if (tak === 0) continue;
    if (topprader.some((rad) => naraNog(rad, nyckel, tak))) {
      ut.push({ value: kedja, confidence: 0.62, kand: true });
    }
  }

  if (ut.length === 0) {
    const gissning = rader.map((r) => r.trim()).find((r) => r.length >= 3 && /[A-Za-zÅÄÖåäö]{3}/.test(r));
    if (gissning) ut.push({ value: gissning.slice(0, 60), confidence: 0.25, kand: false });
  }

  return ut.sort((a, b) => b.confidence - a.confidence);
}

const rakna = (hela: string, nyckel: string): number => {
  if (!nyckel) return 0;
  let n = 0;
  let i = hela.indexOf(nyckel);
  while (i !== -1) {
    n++;
    i = hela.indexOf(nyckel, i + nyckel.length);
  }
  return n;
};

/** Finns nyckeln någonstans i raden med högst `tak` teckenfel? */
function naraNog(rad: string, nyckel: string, tak: number): boolean {
  for (let start = 0; start + nyckel.length - tak <= rad.length; start++) {
    for (let langd = nyckel.length - tak; langd <= nyckel.length + tak; langd++) {
      const bit = rad.slice(start, start + langd);
      if (bit.length === 0) continue;
      if (avstand(bit, nyckel, tak) <= tak) return true;
    }
  }
  return false;
}

/** Levenshtein med tak: avbryter så fort avståndet inte kan bli litet nog. */
function avstand(a: string, b: string, tak: number): number {
  if (Math.abs(a.length - b.length) > tak) return tak + 1;
  let forra = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const rad = [i];
    let minsta = i;
    for (let j = 1; j <= b.length; j++) {
      const kostnad = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(forra[j]! + 1, rad[j - 1]! + 1, forra[j - 1]! + kostnad);
      rad.push(v);
      if (v < minsta) minsta = v;
    }
    if (minsta > tak) return tak + 1;
    forra = rad;
  }
  return forra[b.length]!;
}
