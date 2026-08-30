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
const SCHEMA_VERSION = 2;

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
      unreviewed  INTEGER NOT NULL DEFAULT 0,
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
 * Fälten ett rättningspass går igenom. `currency` står inte med: den utvinns aldrig
 * ur texten utan sätts till kronor, och den visas inte, så ett krav på att någon
 * bekräftar den vore ett krav ingen kan uppfylla — och då sinar kön aldrig.
 */
const GRANSKADE = ["store", "date", "total"] as const;

/**
 * Hur många av fälten som ingen människa sett. Ett fält som saknas helt räknas som
 * ogranskat: det är precis det fall där maskinen inte hittade något och en människa
 * behövs mest.
 */
function unreviewedCount(receipt: Receipt): number {
  const fields = receipt.fields as Record<string, { source?: string } | undefined>;
  return GRANSKADE.filter((namn) => (fields[namn]?.source ?? "ocr") === "ocr").length;
}

const field = (receipt: Receipt, name: string): unknown =>
  (receipt.fields as Record<string, { value?: unknown } | undefined>)[name]?.value;

/** Skrivs alltid *efter* sidecaren. Se skrivordningen i sidecar.ts. */
export function upsert(db: ReceiptIndex, receipt: Receipt): void {
  const tx = db.transaction((r: Receipt) => {
    db.prepare(
      `INSERT INTO receipts (id, captured_at, backlog, segments, store, date, total, currency, unreviewed, indexed_at)
       VALUES (@id, @captured_at, @backlog, @segments, @store, @date, @total, @currency, @unreviewed, @indexed_at)
       ON CONFLICT(id) DO UPDATE SET
         captured_at = excluded.captured_at, backlog = excluded.backlog,
         segments = excluded.segments, store = excluded.store, date = excluded.date,
         total = excluded.total, currency = excluded.currency,
         unreviewed = excluded.unreviewed, indexed_at = excluded.indexed_at`,
    ).run({
      id: r.id,
      captured_at: r.capturedAt,
      backlog: r.backlog ? 1 : 0,
      segments: r.segments.length,
      store: (field(r, "store") as string) ?? null,
      date: (field(r, "date") as string) ?? null,
      total: (field(r, "total") as number) ?? null,
      currency: (field(r, "currency") as string) ?? null,
      unreviewed: unreviewedCount(r),
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

export type PassRow = {
  id: string;
  capturedAt: string;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string | null;
  unreviewed: number;
};

/**
 * Arbetslistan för ett rättningspass: kvitton som är tolkade men vars fält ingen sett.
 *
 * Två villkor, och båda behövs. `length(f.text) > 0` håller otolkade kvitton utanför —
 * de har inga fält att rätta och hör till tolkningskön, inte hit. `unreviewed > 0`
 * är själva kön, och den sinar när fälten är bekräftade eller rättade.
 *
 * Äldst först, till skillnad från arkivlistan. Ett pass betas av framifrån: det som
 * legat längst är det som väntat längst, och ordningen ska inte kastas om av att ett
 * nytt kvitto kommer in medan man håller på.
 */
export function unreviewed(db: ReceiptIndex, limit = 100): PassRow[] {
  return db
    .prepare(
      `SELECT r.id AS id, r.captured_at AS capturedAt, r.store AS store, r.date AS date,
              r.total AS total, r.currency AS currency, r.unreviewed AS unreviewed
         FROM receipts r
         JOIN receipts_fts f ON f.id = r.id
        WHERE length(f.text) > 0 AND r.unreviewed > 0
        ORDER BY r.captured_at ASC
        LIMIT ?`,
    )
    .all(limit) as PassRow[];
}

export function unreviewedTotal(db: ReceiptIndex): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM receipts r JOIN receipts_fts f ON f.id = r.id
        WHERE length(f.text) > 0 AND r.unreviewed > 0`,
    )
    .get() as { n: number };
  return row.n;
}
