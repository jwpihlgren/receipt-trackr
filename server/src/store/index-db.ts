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
const SCHEMA_VERSION = 5;

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

const field = (receipt: Receipt, name: string): unknown =>
  (receipt.fields as Record<string, { value?: unknown } | undefined>)[name]?.value;

/** Skrivs alltid *efter* sidecaren. Se skrivordningen i sidecar.ts. */
export function upsert(db: ReceiptIndex, receipt: Receipt): void {
  const tx = db.transaction((r: Receipt) => {
    db.prepare(
      `INSERT INTO receipts (id, captured_at, backlog, segments, store, date, total, currency,
                             expected, tolkad, tecken_per_rad, sampled, reviewed, indexed_at)
       VALUES (@id, @captured_at, @backlog, @segments, @store, @date, @total, @currency,
               @expected, @tolkad, @tecken_per_rad, @sampled, @reviewed, @indexed_at)
       ON CONFLICT(id) DO UPDATE SET
         captured_at = excluded.captured_at, backlog = excluded.backlog,
         segments = excluded.segments, store = excluded.store, date = excluded.date,
         total = excluded.total, currency = excluded.currency,
         expected = excluded.expected, tolkad = excluded.tolkad,
         tecken_per_rad = excluded.tecken_per_rad, sampled = excluded.sampled,
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
 * Kvitton som ännu inte har någon text. Det är kön, härledd ur indexet i stället för
 * lagrad någonstans — precis som allt annat sökbart. En reservation är däremot inte
 * härledd och hör inte hemma här; den lever i minnet, se jobb.ts.
 *
 * FTS-raden finns alltid, även tom: `upsert` skriver in den vid varje skrivning. Så
 * frågan blir "vilken rad har tom text", inte "vilken rad saknas".
 */
export function pendingOcr(db: ReceiptIndex, limit = 50): { id: string; capturedAt: string }[] {
  return db
    .prepare(
      `SELECT r.id AS id, r.captured_at AS capturedAt
         FROM receipts r
         JOIN receipts_fts f ON f.id = r.id
        WHERE length(f.text) = 0
        ORDER BY r.captured_at DESC
        LIMIT ?`,
    )
    .all(limit) as { id: string; capturedAt: string }[];
}

export function pendingOcrCount(db: ReceiptIndex): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM receipts r JOIN receipts_fts f ON f.id = r.id WHERE length(f.text) = 0`,
    )
    .get() as { n: number };
  return row.n;
}

export type SearchHit = {
  id: string;
  capturedAt: string;
  segments: number;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  snippet: string;
};

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

export function search(db: ReceiptIndex, query: string, limit = 50): SearchHit[] {
  return db
    .prepare(
      `SELECT r.id AS id, r.captured_at AS capturedAt, r.segments AS segments,
              r.store AS store, r.date AS date, r.total AS total, r.currency AS currency,
              snippet(receipts_fts, 0, '[', ']', '…', 12) AS snippet
       FROM receipts_fts f JOIN receipts r ON r.id = f.id
       WHERE receipts_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit) as SearchHit[];
}

export type ReceiptRow = {
  id: string;
  capturedAt: string;
  segments: number;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  /**
   * Hur många tecken texten har. Noll betyder otolkat.
   *
   * Raden behöver den, och skälet är ett fel den här listan hade: den visade `store`
   * som enda tecken på att något hänt, och `store` fylls först av fältutvinningen i
   * M6. Tolkningen kunde alltså läsa hela kvittot utan att det syntes någonstans, och
   * det såg ut som att ingenting fungerade. Texten finns före fälten, och då ska den
   * också gå att se.
   */
  tecken: number;
};

/** Senaste kvittona, nyast först. Indexet har redan sorteringen som kolumn. */
export function recent(db: ReceiptIndex, limit = 50, before?: string): ReceiptRow[] {
  const where = before ? "WHERE r.captured_at < ?" : "";
  const params = before ? [before, limit] : [limit];
  return db
    .prepare(
      `SELECT r.id AS id, r.captured_at AS capturedAt, r.segments AS segments,
              r.store AS store, r.date AS date, r.total AS total, r.currency AS currency,
              length(f.text) AS tecken
       FROM receipts r LEFT JOIN receipts_fts f ON f.id = r.id
       ${where} ORDER BY r.captured_at DESC LIMIT ?`,
    )
    .all(...params) as ReceiptRow[];
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
              r.tecken_per_rad AS teckenPerRad, length(f.text) AS tecken
         FROM receipts r
         JOIN receipts_fts f ON f.id = r.id
        WHERE NOT (
                r.expected IS NOT NULL AND r.segments >= r.expected
                AND r.tolkad = 1 AND length(f.text) > 0
                AND r.store IS NOT NULL AND r.date IS NOT NULL AND r.total IS NOT NULL
                AND (r.tecken_per_rad IS NULL OR r.tecken_per_rad >= ${TECKEN_PER_RAD_GRANS})
              )
        ORDER BY r.captured_at DESC
        LIMIT ?`,
    )
    .all(limit) as (KvittoRad & {
    segments: number;
    expected: number | null;
    tolkad: number;
    tecken: number;
    teckenPerRad: number | null;
  })[];

  return rader.map(({ segments, expected, tolkad, tecken, teckenPerRad, ...rad }) => {
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
            : tecken === 0
              ? "utan_text"
              : teckenPerRad !== null && teckenPerRad < TECKEN_PER_RAD_GRANS
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
