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

export function openIndex(path: string): ReceiptIndex {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
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
      indexed_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS receipts_captured_at ON receipts (captured_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS receipts_fts USING fts5(
      text,
      id UNINDEXED,
      tokenize = "unicode61 remove_diacritics 2"
    );
  `);
  return db;
}

const field = (receipt: Receipt, name: string): unknown =>
  (receipt.fields as Record<string, { value?: unknown } | undefined>)[name]?.value;

/** Skrivs alltid *efter* sidecaren. Se skrivordningen i sidecar.ts. */
export function upsert(db: ReceiptIndex, receipt: Receipt): void {
  const tx = db.transaction((r: Receipt) => {
    db.prepare(
      `INSERT INTO receipts (id, captured_at, backlog, segments, store, date, total, currency, indexed_at)
       VALUES (@id, @captured_at, @backlog, @segments, @store, @date, @total, @currency, @indexed_at)
       ON CONFLICT(id) DO UPDATE SET
         captured_at = excluded.captured_at, backlog = excluded.backlog,
         segments = excluded.segments, store = excluded.store, date = excluded.date,
         total = excluded.total, currency = excluded.currency, indexed_at = excluded.indexed_at`,
    ).run({
      id: r.id,
      captured_at: r.capturedAt,
      backlog: r.backlog ? 1 : 0,
      segments: r.segments.length,
      store: (field(r, "store") as string) ?? null,
      date: (field(r, "date") as string) ?? null,
      total: (field(r, "total") as number) ?? null,
      currency: (field(r, "currency") as string) ?? null,
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

export const count = (db: ReceiptIndex): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM receipts").get() as { n: number }).n;
