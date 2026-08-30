/**
 * Sökindexet. Det är **härlett** — allt här går att kasta och bygga om från
 * `receipts/**` med `reindex`. Följden är att inga databasmigreringar behövs
 * någonsin: ett schemabyte är en ombyggnad.
 *
 * FTS5 tokeniseras med `remove_diacritics 2`, alltså med å, ä och ö hopvikta mot a
 * och o. Det är ett medvetet avsteg från svensk sorteringskonvention och beror på
 * mätningen i M0: OCR:en förväxlar diakriterna åt båda hållen på båda modellnivåerna,
 * så en sökning på "återköp" måste hitta "äterköp". Texten är maskinläst, inte
 * inskriven — då väger sökbarheten tyngre än konventionen.
 */
import Database from "better-sqlite3";
import type { Receipt } from "./sidecar.js";

export type ReceiptIndex = Database.Database;

/**
 * Schemaversionen är den enda migrationsmekanism som finns, och den migrerar
 * ingenting: stämmer den inte kastas tabellerna och byggs om ur `receipts/`.
 * Det är hela poängen med ett härlett index — höj siffran när kolumnerna ändras
 * och skriv aldrig ett `ALTER TABLE`.
 */
const SCHEMA_VERSION = 6;

export function openIndex(path: string): { db: ReceiptIndex; rebuilt: boolean } {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // En tom, nyskapad databas står också på noll. Det gör ingen skada: att kasta
  // tabeller som inte finns är en tystnad, och ombyggnaden av ett tomt arkiv likaså.
  const version = db.pragma("user_version", { simple: true }) as number;
  const rebuilt = version !== SCHEMA_VERSION;
  if (rebuilt) db.exec(`DROP TABLE IF EXISTS receipts; DROP TABLE IF EXISTS receipts_fts;`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id          TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      backlog     INTEGER NOT NULL,
      segments    INTEGER NOT NULL,
      store       TEXT,
      date        TEXT,
      total       REAL,
      currency    TEXT,
      expected    INTEGER,
      tolkad      INTEGER NOT NULL DEFAULT 0,
      tecken_per_rad REAL,
      manuella    INTEGER NOT NULL DEFAULT 0,
      sampled     INTEGER NOT NULL DEFAULT 0,
      reviewed    INTEGER NOT NULL DEFAULT 0,
      indexed_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS receipts_captured_at ON receipts (captured_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS receipts_fts USING fts5(
      text,
      id UNINDEXED,
      tokenize = "unicode61 remove_diacritics 2"
    );
  `);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return { db, rebuilt };
}

/**
 * Tecken per läst rad — kvalitetsmåttet från M5a, räknat av klienten som läste bilden.
 *
 * `null` när måttet inte finns: kvitton som tolkades innan det skrevs, och kvitton som
 * inte tolkats alls. Det är inte samma sak som ett dåligt värde och får inte behandlas
 * som ett.
 */
function teckenPerRad(receipt: Receipt): number | null {
  const varde = (receipt.ocr as { teckenPerRad?: unknown } | null)?.teckenPerRad;
  return typeof varde === "number" && Number.isFinite(varde) ? varde : null;
}

/**
 * Hur många av de tre fälten en människa satt själv.
 *
 * Behövs för kvalitetsflaggan: den säger "lita inte på maskinen här", och när någon
 * skrivit in alla tre värdena för hand finns ingen maskinläsning kvar att misstro.
 * Utan det här skulle ett kvitto man redan lagat stå kvar i tabellen för alltid.
 */
function manuella(receipt: Receipt): number {
  const fields = receipt.fields as Record<string, { source?: string } | undefined>;
  return ["store", "date", "total"].filter((namn) => {
    const kalla = fields[namn]?.source;
    return kalla === "manual" || kalla === "confirmed";
  }).length;
}

const field = (receipt: Receipt, name: string): unknown =>
  (receipt.fields as Record<string, { value?: unknown } | undefined>)[name]?.value;

/** Skrivs alltid *efter* sidecaren. Se skrivordningen i sidecar.ts. */
export function upsert(db: ReceiptIndex, receipt: Receipt): void {
  const tx = db.transaction((r: Receipt) => {
    db.prepare(
      `INSERT INTO receipts (id, captured_at, backlog, segments, store, date, total, currency,
                             expected, tolkad, tecken_per_rad, manuella, sampled, reviewed, indexed_at)
       VALUES (@id, @captured_at, @backlog, @segments, @store, @date, @total, @currency,
               @expected, @tolkad, @tecken_per_rad, @manuella, @sampled, @reviewed, @indexed_at)
       ON CONFLICT(id) DO UPDATE SET
         captured_at = excluded.captured_at, backlog = excluded.backlog,
         segments = excluded.segments, store = excluded.store, date = excluded.date,
         total = excluded.total, currency = excluded.currency,
         expected = excluded.expected, tolkad = excluded.tolkad,
         tecken_per_rad = excluded.tecken_per_rad, manuella = excluded.manuella,
         sampled = excluded.sampled,
         reviewed = excluded.reviewed, indexed_at = excluded.indexed_at`,
    ).run({
      id: r.id,
      captured_at: r.capturedAt,
      backlog: r.backlog ? 1 : 0,
      segments: r.segments.length,
      store: (field(r, "store") as string) ?? null,
      date: (field(r, "date") as string) ?? null,
      total: (field(r, "total") as number) ?? null,
      currency: (field(r, "currency") as string) ?? null,
      expected: r.expectedSegments,
      // Att tolkningen *körts* är något annat än att den gav text. Utan den
      // skillnaden går ett kvitto som väntar på sin tur inte att skilja från ett där
      // maskinen läste och inte fick ut ett tecken.
      tolkad: r.ocr ? 1 : 0,
      tecken_per_rad: teckenPerRad(r),
      manuella: manuella(r),
      sampled: r.review?.sampled ? 1 : 0,
      reviewed: r.review?.verdict ? 1 : 0,
      indexed_at: new Date().toISOString(),
    });
    // FTS5 saknar upsert: raden ersätts i stället, vilket är samma sak här.
    db.prepare("DELETE FROM receipts_fts WHERE id = ?").run(r.id);
    db.prepare("INSERT INTO receipts_fts (id, text) VALUES (?, ?)").run(r.id, r.text ?? "");
  });
  tx(receipt);
}

export function remove(db: ReceiptIndex, id: string): void {
  db.prepare("DELETE FROM receipts WHERE id = ?").run(id);
  db.prepare("DELETE FROM receipts_fts WHERE id = ?").run(id);
}

/**
 * Kvitton som väntar på sin tur. Kön är härledd ur indexet i stället för lagrad
 * någonstans — precis som allt annat sökbart. En reservation är däremot inte härledd
 * och hör inte hemma här; den lever i minnet, se jobb.ts.
 *
 * Villkoret är `tolkad = 0`, alltså "tolkningen har inte körts", inte "det finns
 * ingen text". Skillnaden är hela skälet: en bild som lästes till noll tecken har
 * körts, och att dela ut den igen ger samma noll tecken. Den hör till aktiviteten,
 * inte till kön. Vill man ändå läsa om den finns *Läs om bilden*, som nollställer
 * `ocr` och därmed lägger tillbaka kvittot här.
 */
export function pendingOcr(db: ReceiptIndex, limit = 50): { id: string; capturedAt: string }[] {
  return db
    .prepare(
      `SELECT r.id AS id, r.captured_at AS capturedAt
         FROM receipts r
        WHERE r.tolkad = 0
        ORDER BY r.captured_at DESC
        LIMIT ?`,
    )
    .all(limit) as { id: string; capturedAt: string }[];
}

export function pendingOcrCount(db: ReceiptIndex): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM receipts r WHERE r.tolkad = 0`,
    )
    .get() as { n: number };
  return row.n;
}

/**
 * Användarens text är inte FTS5-syntax. Varje ord citeras för sig och binds ihop med
 * AND — inte hela frågan som en fras, för då kräver "kakel badrum" att orden står
 * intill varandra, och kravställningens eget slutprov är just "vad kostade allt kakel
 * till badrummet". Vill man ha en fras skriver man citattecken, och då bevaras den.
 */
export function ftsQuery(raw: string): string {
  const phrases = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const rest = raw.replace(/"[^"]*"/g, " ");
  const words = rest.split(/[\s,.;:!?()[\]{}]+/).filter(Boolean);
  const terms = [...phrases, ...words].map((t) => `"${t.replace(/"/g, '""')}"`);
  return terms.join(" AND ");
}

export type ArkivRad = {
  id: string;
  /** Kvittots eget datum — det man handlade. Sorteringen går på det, inte på fångsten. */
  date: string | null;
  store: string | null;
  total: number | null;
  currency: string | null;
  capturedAt: string;
  segments: number;
  snippet: string | null;
  /** Antal tecken i den utlästa texten. Noll betyder att tolkningen inte gett något. */
  tecken: number;
};

export type ArkivFraga = {
  q?: string;
  butik?: string;
  fran?: string;
  till?: string;
  limit?: number;
  /**
   * Ta med ofärdiga kvitton också. Skrivbordets arkiv vill inte det — där är
   * Aktivitet den andra halvan. Telefonens hemskärm vill det: ett kvitto man just
   * fotograferat måste synas där, annars ser fångsten ut att ha misslyckats.
   */
  ofardiga?: boolean;
};

/**
 * Arkivet: klara kvitton, filtrerade, nyaste köp först.
 *
 * Fritexten och filtren bor i samma fråga med flit. De låg i var sin rutt, och då gick
 * det inte att söka på ett ord *och* begränsa till en butik — vilket är det första man
 * vill göra så fort högen blivit stor nog att söka i.
 *
 * Ofärdiga kvitton står inte här. De hör till aktiviteten; blandas de in blir arkivet
 * en lista där en del av raderna saknar just det man letar efter.
 */
export function arkiv(db: ReceiptIndex, fraga: ArkivFraga): { total: number; receipts: ArkivRad[] } {
  const villkor: string[] = fraga.ofardiga ? [] : [KLAR];
  const params: unknown[] = [];
  if (fraga.q) {
    villkor.push("receipts_fts MATCH ?");
    params.push(fraga.q);
  }
  if (fraga.butik) {
    villkor.push("r.store = ?");
    params.push(fraga.butik);
  }
  if (fraga.fran) {
    villkor.push("r.date >= ?");
    params.push(fraga.fran);
  }
  if (fraga.till) {
    villkor.push("r.date <= ?");
    params.push(fraga.till);
  }
  const where = villkor.length ? villkor.join(" AND ") : "1 = 1";
  const from = "FROM receipts r JOIN receipts_fts f ON f.id = r.id";

  const total = (db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(...params) as { n: number }).n;
  const receipts = db
    .prepare(
      `SELECT r.id AS id, r.date AS date, r.store AS store, r.total AS total,
              r.currency AS currency, r.captured_at AS capturedAt, r.segments AS segments,
              length(f.text) AS tecken,
              ${fraga.q ? "snippet(receipts_fts, 0, '[', ']', '…', 12)" : "NULL"} AS snippet
         ${from} WHERE ${where}
        ORDER BY r.date DESC, r.captured_at DESC
        LIMIT ?`,
    )
    .all(...params, Math.min(Math.max(fraga.limit ?? 200, 1), 1000)) as ArkivRad[];
  return { total, receipts };
}

/** Butikerna som faktiskt finns i arkivet — filtrets alternativ, inte en påhittad lista. */
export function butiker(db: ReceiptIndex): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT r.store AS store FROM receipts r JOIN receipts_fts f ON f.id = r.id
          WHERE ${KLAR} AND r.store IS NOT NULL ORDER BY r.store COLLATE NOCASE`,
      )
      .all() as { store: string }[]
  ).map((r) => r.store);
}

/**
 * Rader vars kvitto inte längre finns på disken.
 *
 * `upsert` sätter `indexed_at` på varje kvitto den ser, så allt äldre än ombyggnadens
 * start saknar motsvarighet i `receipts/`. Utan det här skulle ett raderat kvitto leva
 * kvar i listorna som en rad som ger 404 när man klickar på den.
 */
export function rensaAldreAn(db: ReceiptIndex, tidpunkt: string): number {
  const rader = db.prepare("SELECT id FROM receipts WHERE indexed_at < ?").all(tidpunkt) as { id: string }[];
  for (const rad of rader) remove(db, rad.id);
  return rader.length;
}

export const count = (db: ReceiptIndex): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM receipts").get() as { n: number }).n;

export type KvittoRad = {
  id: string;
  capturedAt: string;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
};

/** Vad som står i vägen för att kvittot ska vara färdigt. Ett enda ord per rad. */
export type Lage = "bilder" | "ofullstandig" | "vantar" | "utan_text" | "svag_text" | "saknar_falt";

/**
 * Gränsen för tecken per läst rad, mätt i M5a: de två suddiga segmenten gav 4,0 och
 * 5,4 mot normalfallets 11. Under den här siffran har detektorn ramat in rader som
 * igenkänningen sedan läst tecken för tecken, och texten är inte att lita på — hur
 * hög konfidensen än råkar vara.
 */
const TECKEN_PER_RAD_GRANS = 7;

/**
 * Vad det innebär att ett kvitto är klart, skrivet en gång.
 *
 * Arkivlistan visar det som uppfyller det här; aktiviteten visar allt annat. Två
 * ställen som frågar om samma sak måste fråga likadant, annars finns kvitton som
 * varken syns i den ena listan eller den andra.
 *
 * **`manuella = 3` väger tyngre än maskinen.** Har en människa satt alla tre fälten
 * själv — skrivit in dem eller sagt att maskinens läsning stämmer — är kvittot klart
 * oavsett hur illa tolkningen gick. Utan den regeln fanns lägen utan utgång: en bild
 * som lästes till noll tecken kunde bara läsas om till noll tecken igen, och ett
 * kvitto flaggat som svagt läst blev aldrig kvitt flaggan.
 */
const KLAR = `(
  r.expected IS NOT NULL AND r.segments >= r.expected
  AND r.store IS NOT NULL AND r.date IS NOT NULL AND r.total IS NOT NULL
  AND (
    (r.tolkad = 1 AND length(f.text) > 0
      AND (r.tecken_per_rad IS NULL OR r.tecken_per_rad >= ${TECKEN_PER_RAD_GRANS}))
    OR r.manuella = 3
  )
)`;

export type Ofardigt = KvittoRad & {
  lage: Lage;
  /** Utlovade bilder som aldrig kom fram. */
  saknadeBilder: number;
  /** Fält maskinen inte hittade. */
  saknadeFalt: string[];
  tecken: number;
  /** Tecken per läst rad. `null` när måttet saknas — inte samma sak som noll. */
  teckenPerRad: number | null;
};

/**
 * Allt som inte är färdigt, oavsett vad som saknas.
 *
 * Ett kvitto är färdigt när fångsten är avslutad, alla utlovade bilder finns,
 * tolkningen körts och gett text, och butik, datum och belopp går att läsa ur den.
 * Allt annat står här med sitt läge — det som väntar på sin tur lika väl som det som
 * gått fel, för båda är saker som ännu inte landat.
 *
 * Låg konfidens gör inte ett kvitto ofärdigt. Konfidensen mäts, den beordrar inget.
 */
export function ofardiga(db: ReceiptIndex, limit = 500): Ofardigt[] {
  const rader = db
    .prepare(
      `SELECT r.id AS id, r.captured_at AS capturedAt, r.store AS store, r.date AS date,
              r.total AS total, r.currency AS currency,
              r.segments AS segments, r.expected AS expected, r.tolkad AS tolkad,
              r.tecken_per_rad AS teckenPerRad, r.manuella AS manuella, length(f.text) AS tecken
         FROM receipts r
         JOIN receipts_fts f ON f.id = r.id
        WHERE NOT ${KLAR}
        ORDER BY r.captured_at DESC
        LIMIT ?`,
    )
    .all(limit) as (KvittoRad & {
    segments: number;
    expected: number | null;
    tolkad: number;
    tecken: number;
    teckenPerRad: number | null;
    manuella: number;
  })[];

  return rader.map(({ segments, expected, tolkad, tecken, teckenPerRad, manuella, ...rad }) => {
    const saknadeBilder = expected === null ? 0 : Math.max(0, expected - segments);
    const saknadeFalt =
      tolkad === 1 && tecken > 0
        ? [
            ...(rad.store === null ? ["butik"] : []),
            ...(rad.date === null ? ["datum"] : []),
            ...(rad.total === null ? ["belopp"] : []),
          ]
        : [];
    // Ordningen är angelägenhetens. En förlorad bild går inte att ta om och står
    // därför först, oavsett vad mer som saknas på samma kvitto.
    const lage: Lage =
      saknadeBilder > 0
        ? "bilder"
        : expected === null
          ? "ofullstandig"
          : tolkad === 0
            ? "vantar"
            : tecken === 0 && manuella < 3
              ? "utan_text"
              : teckenPerRad !== null && teckenPerRad < TECKEN_PER_RAD_GRANS && manuella < 3
                ? // Före saknade fält, för det är svagt läst text som orsakar dem.
                  "svag_text"
                : "saknar_falt";
    return { ...rad, lage, saknadeBilder, saknadeFalt, tecken, teckenPerRad };
  });
}

/**
 * Kalibreringsurvalets kö: dragna kvitton som ingen granskat än.
 *
 * Ordningen är slumpen som redan skett — urvalet drogs slumpmässigt, och att sedan
 * beta av det i ULID-ordning tillför ingen skevhet. Det gör däremot listan
 * förutsägbar att komma tillbaka till, vilket en slumpad ordning inte hade varit.
 */
export function ogranskatUrval(db: ReceiptIndex, limit = 200): KvittoRad[] {
  return db
    .prepare(
      `SELECT r.id AS id, r.captured_at AS capturedAt, r.store AS store, r.date AS date,
              r.total AS total, r.currency AS currency
         FROM receipts r
        WHERE r.sampled = 1 AND r.reviewed = 0
        ORDER BY r.captured_at ASC
        LIMIT ?`,
    )
    .all(limit) as KvittoRad[];
}

/** Ett kvittos läge, eller `null` när det är klart. Härlett — står aldrig i sidecaren. */
export function lageFor(db: ReceiptIndex, id: string): Ofardigt | null {
  return ofardiga(db, 500).find((r) => r.id === id) ?? null;
}

export type UrvalLage = { urval: number; granskade: number; kvar: number; dragbara: number };

/**
 * Hur urvalet står. `dragbara` är hur många tolkade kvitton som ännu inte är dragna —
 * alltså hur mycket större urvalet skulle kunna bli om man drog om.
 */
export function urvalLage(db: ReceiptIndex): UrvalLage {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM receipts WHERE sampled = 1) AS urval,
         (SELECT COUNT(*) FROM receipts WHERE sampled = 1 AND reviewed = 1) AS granskade,
         (SELECT COUNT(*) FROM receipts r JOIN receipts_fts f ON f.id = r.id
           WHERE r.sampled = 0 AND length(f.text) > 0) AS dragbara`,
    )
    .get() as { urval: number; granskade: number; dragbara: number };
  return { ...row, kvar: row.urval - row.granskade };
}

/**
 * Kvitton som får dras: tolkade, och inte redan i urvalet.
 *
 * Konfidensen står medvetet inte i villkoret. Ett urval som vet något om konfidensen
 * när det dras kan inte användas för att mäta konfidensen — det är hela skälet till
 * att den här funktionen finns i stället för att man granskar det som ser osäkert ut.
 */
export function dragbara(db: ReceiptIndex): string[] {
  return (
    db
      .prepare(
        `SELECT r.id AS id FROM receipts r JOIN receipts_fts f ON f.id = r.id
          WHERE r.sampled = 0 AND length(f.text) > 0`,
      )
      .all() as { id: string }[]
  ).map((r) => r.id);
}
