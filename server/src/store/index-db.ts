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
import { utvinnIdentitet, type Identitet } from "../falt/identitet.js";
import { gruppera, nyckel } from "../falt/matchning.js";
import { rosta } from "../falt/rostning.js";
import type { Falten } from "../falt/index.js";

export type ReceiptIndex = Database.Database;

/**
 * Schemaversionen är den enda migrationsmekanism som finns, och den migrerar
 * ingenting: stämmer den inte kastas tabellerna och byggs om ur `receipts/`.
 * Det är hela poängen med ett härlett index — höj siffran när kolumnerna ändras
 * och skriv aldrig ett `ALTER TABLE`.
 */
const SCHEMA_VERSION = 7;

export function openIndex(path: string): { db: ReceiptIndex; rebuilt: boolean } {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // En tom, nyskapad databas står också på noll. Det gör ingen skada: att kasta
  // tabeller som inte finns är en tystnad, och ombyggnaden av ett tomt arkiv likaså.
  const version = db.pragma("user_version", { simple: true }) as number;
  const rebuilt = version !== SCHEMA_VERSION;
  if (rebuilt) {
    db.exec(`DROP TABLE IF EXISTS receipts; DROP TABLE IF EXISTS receipts_fts; DROP TABLE IF EXISTS kortref;`);
  }

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
      egna_falt   TEXT NOT NULL DEFAULT '{}',
      egen_datum  TEXT,
      egen_belopp REAL,
      orgnr       TEXT,
      kvittonummer TEXT,
      tid         TEXT,
      grupp       TEXT,
      expected    INTEGER,
      tolkad      INTEGER NOT NULL DEFAULT 0,
      tecken_per_rad REAL,
      manuella    INTEGER NOT NULL DEFAULT 0,
      sampled     INTEGER NOT NULL DEFAULT 0,
      reviewed    INTEGER NOT NULL DEFAULT 0,
      indexed_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS receipts_captured_at ON receipts (captured_at DESC);
    CREATE INDEX IF NOT EXISTS receipts_grupp ON receipts (grupp);
    -- Blockningsnyckeln: en match kräver alltid samma dag och samma belopp, eller en
    -- delad kortreferens. Utan det här indexet vore grupperingen en jämförelse mot
    -- hela arkivet vid varje skrivning.
    CREATE INDEX IF NOT EXISTS receipts_egna ON receipts (egen_datum, egen_belopp);
    CREATE TABLE IF NOT EXISTS kortref (
      id  TEXT NOT NULL,
      ref TEXT NOT NULL,
      PRIMARY KEY (id, ref)
    );
    CREATE INDEX IF NOT EXISTS kortref_ref ON kortref (ref);
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
 *
 * Räknas på de **effektiva** fälten, alltså efter röstningen. En människas ord om ett
 * kvitto gäller köpet, inte det enskilda fotografiet av det.
 */
function manuella(falt: Falten): number {
  const fields = falt as Record<string, { source?: string } | undefined>;
  return ["store", "date", "total"].filter((namn) => {
    const kalla = fields[namn]?.source;
    return kalla === "manual" || kalla === "confirmed";
  }).length;
}

const varde = (falt: Falten, namn: string): unknown =>
  (falt as Record<string, { value?: unknown } | undefined>)[namn]?.value;

/**
 * Kvittots egen läsning, som den står i sidecaren. Den sparas som JSON i indexet av
 * ett enda skäl: röstningen behöver varje medlems eget värde *med konfidens och
 * källa*, och att läsa tre sidecarer från disk vid varje skrivning vore att göra
 * indexet beroende av filsystemet mitt i en transaktion.
 */
function egnaFalten(rad: { egna_falt: string }): Falten {
  try {
    return JSON.parse(rad.egna_falt) as Falten;
  } catch {
    return {};
  }
}

/** Skrivs alltid *efter* sidecaren. Se skrivordningen i sidecar.ts. */
export function upsert(db: ReceiptIndex, receipt: Receipt): void {
  const tx = db.transaction((r: Receipt) => {
    const egna = (r.fields ?? {}) as Falten;
    /**
     * Identiteten står i sidecaren sedan den skrevs av `saveOcr`. Saknas den — en
     * sidecar från innan fältet fanns — läses den ur texten här i stället, så att ett
     * äldre arkiv får sina grupper av en `reindex` utan att först behöva omtolkas.
     */
    const identitet: Identitet = r.identity ?? (r.text ? utvinnIdentitet(r.text) : {});

    db.prepare(
      `INSERT INTO receipts (id, captured_at, backlog, segments, store, date, total, currency,
                             egna_falt, egen_datum, egen_belopp, orgnr, kvittonummer, tid,
                             expected, tolkad, tecken_per_rad, manuella, sampled, reviewed, indexed_at)
       VALUES (@id, @captured_at, @backlog, @segments, @store, @date, @total, @currency,
               @egna_falt, @egen_datum, @egen_belopp, @orgnr, @kvittonummer, @tid,
               @expected, @tolkad, @tecken_per_rad, @manuella, @sampled, @reviewed, @indexed_at)
       ON CONFLICT(id) DO UPDATE SET
         captured_at = excluded.captured_at, backlog = excluded.backlog,
         segments = excluded.segments, store = excluded.store, date = excluded.date,
         total = excluded.total, currency = excluded.currency,
         egna_falt = excluded.egna_falt, egen_datum = excluded.egen_datum,
         egen_belopp = excluded.egen_belopp, orgnr = excluded.orgnr,
         kvittonummer = excluded.kvittonummer, tid = excluded.tid,
         expected = excluded.expected, tolkad = excluded.tolkad,
         tecken_per_rad = excluded.tecken_per_rad, manuella = excluded.manuella,
         sampled = excluded.sampled,
         reviewed = excluded.reviewed, indexed_at = excluded.indexed_at`,
    ).run({
      id: r.id,
      captured_at: r.capturedAt,
      backlog: r.backlog ? 1 : 0,
      segments: r.segments.length,
      // De effektiva värdena sätts av grupperingen strax nedan. Här skrivs kvittots
      // egen läsning, så att raden är sann även om processen dör däremellan: ett
      // kvitto utan grupp är sin egen sanning, och det är det vanliga fallet.
      store: (varde(egna, "store") as string) ?? null,
      date: (varde(egna, "date") as string) ?? null,
      total: (varde(egna, "total") as number) ?? null,
      currency: (varde(egna, "currency") as string) ?? null,
      egna_falt: JSON.stringify(egna),
      // Grupperingens nyckel läses alltid ur kvittots **egen** läsning, aldrig ur det
      // röstade resultatet. Annars skulle grupperna mata sig själva: ett värde som en
      // grupp gett ett kvitto kunde dra in ett tredje, som i sin tur ändrade värdet.
      egen_datum: (varde(egna, "date") as string) ?? null,
      egen_belopp: (varde(egna, "total") as number) ?? null,
      orgnr: identitet.orgnr ?? null,
      kvittonummer: identitet.kvittonummer ?? null,
      tid: identitet.tid ?? null,
      expected: r.expectedSegments,
      // Att tolkningen *körts* är något annat än att den gav text. Utan den
      // skillnaden går ett kvitto som väntar på sin tur inte att skilja från ett där
      // maskinen läste och inte fick ut ett tecken.
      tolkad: r.ocr ? 1 : 0,
      tecken_per_rad: teckenPerRad(r),
      manuella: manuella(egna),
      sampled: r.review?.sampled ? 1 : 0,
      reviewed: r.review?.verdict ? 1 : 0,
      indexed_at: new Date().toISOString(),
    });
    db.prepare("DELETE FROM kortref WHERE id = ?").run(r.id);
    const skrivRef = db.prepare("INSERT OR IGNORE INTO kortref (id, ref) VALUES (?, ?)");
    for (const ref of identitet.kortref ?? []) skrivRef.run(r.id, ref);

    // FTS5 saknar upsert: raden ersätts i stället, vilket är samma sak här.
    db.prepare("DELETE FROM receipts_fts WHERE id = ?").run(r.id);
    db.prepare("INSERT INTO receipts_fts (id, text) VALUES (?, ?)").run(r.id, r.text ?? "");

    omgruppera(db, r.id);
  });
  tx(receipt);
}

export function remove(db: ReceiptIndex, id: string): void {
  const rad = db.prepare("SELECT grupp FROM receipts WHERE id = ?").get(id) as { grupp: string | null } | undefined;
  db.prepare("DELETE FROM receipts WHERE id = ?").run(id);
  db.prepare("DELETE FROM receipts_fts WHERE id = ?").run(id);
  db.prepare("DELETE FROM kortref WHERE id = ?").run(id);
  // Gruppen kvittot stod i måste räknas om: blir en enda medlem kvar är det ingen
  // grupp längre, och den som blir ensam ska få tillbaka sin egen läsning.
  if (rad?.grupp) {
    const kvar = db.prepare("SELECT id FROM receipts WHERE grupp = ? ORDER BY id LIMIT 1").get(rad.grupp) as
      | { id: string }
      | undefined;
    if (kvar) omgruppera(db, kvar.id);
  }
}

// ---------------------------------------------------------------------------
// Grupperna: vilka kvitton som visar samma köp
// ---------------------------------------------------------------------------

/**
 * Grupperna är **härledda**, precis som allt annat i den här filen. De står aldrig i
 * en sidecar, och det är inte en förenkling utan följden av skrivordningen: en grupp
 * är ett påstående om två kvitton, och två sidecarer kan inte skrivas atomiskt
 * tillsammans. I indexet får påståendet kastas och räknas om när som helst.
 *
 * Gruppens id är dess minsta medlems-id. ULID:er sorteras i tidsordning, så namnet är
 * det först fångade kvittot i gruppen — stabilt, och räknat ur medlemmarna själva i
 * stället för myntat, så att en ombyggnad ger exakt samma namn.
 */
type GruppRad = {
  id: string;
  egna_falt: string;
  egen_datum: string | null;
  egen_belopp: number | null;
  orgnr: string | null;
  kvittonummer: string | null;
  tid: string | null;
  grupp: string | null;
};

const platshallare = (n: number): string => Array.from({ length: n }, () => "?").join(", ");

/**
 * Kvitton som över huvud taget *kan* vara samma köp som `id`, plus hela de grupper de
 * redan står i.
 *
 * Urvalet får vara för brett men aldrig för smalt, och `matchar()` avgör sedan. Två
 * villkor räcker för att inte missa någon: en match kräver antingen samma dag och
 * samma belopp — spärrarna i `matchning.ts` släpper inget annat vidare till en nivå
 * som binder — eller en delad kortreferens, som är den enda vägen förbi dem.
 *
 * Grupperna kring kandidaterna tas med därför att en ändring kan **lösa upp** något:
 * ändras ett belopp ska de som stod kvar i gruppen räknas om i samma andetag, annars
 * blir en halv grupp kvar och pekar på ett köp som inte längre finns.
 */
function grannskap(db: ReceiptIndex, id: string): string[] {
  const rad = db.prepare("SELECT egen_datum, egen_belopp, grupp FROM receipts WHERE id = ?").get(id) as
    | { egen_datum: string | null; egen_belopp: number | null; grupp: string | null }
    | undefined;
  if (!rad) return [];

  const ids = new Set<string>([id]);
  if (rad.egen_datum !== null && rad.egen_belopp !== null) {
    const lika = db
      .prepare("SELECT id FROM receipts WHERE egen_datum = ? AND egen_belopp = ?")
      .all(rad.egen_datum, rad.egen_belopp) as { id: string }[];
    for (const r of lika) ids.add(r.id);
  }
  const delade = db
    .prepare("SELECT b.id AS id FROM kortref a JOIN kortref b ON b.ref = a.ref WHERE a.id = ?")
    .all(id) as { id: string }[];
  for (const r of delade) ids.add(r.id);

  const kanda = [...ids];
  const grupper = db
    .prepare(`SELECT DISTINCT grupp FROM receipts WHERE grupp IS NOT NULL AND id IN (${platshallare(kanda.length)})`)
    .all(...kanda) as { grupp: string }[];
  for (const { grupp } of [...grupper, ...(rad.grupp ? [{ grupp: rad.grupp }] : [])]) {
    const medlemmar = db.prepare("SELECT id FROM receipts WHERE grupp = ?").all(grupp) as { id: string }[];
    for (const m of medlemmar) ids.add(m.id);
  }
  return [...ids];
}

/** Räknar om grupperna kring ett kvitto, och skriver om de effektiva fälten. */
function omgruppera(db: ReceiptIndex, id: string): void {
  const ids = grannskap(db, id);
  if (ids.length === 0) return;

  const rader = db
    .prepare(
      `SELECT id, egna_falt, egen_datum, egen_belopp, orgnr, kvittonummer, tid, grupp
         FROM receipts WHERE id IN (${platshallare(ids.length)})`,
    )
    .all(...ids) as GruppRad[];

  const refs = new Map<string, string[]>();
  for (const rad of db
    .prepare(`SELECT id, ref FROM kortref WHERE id IN (${platshallare(ids.length)})`)
    .all(...ids) as { id: string; ref: string }[]) {
    refs.set(rad.id, [...(refs.get(rad.id) ?? []), rad.ref]);
  }

  const nycklar = rader.map((rad) =>
    nyckel(
      rad.id,
      {
        ...(rad.orgnr ? { orgnr: rad.orgnr } : {}),
        ...(rad.kvittonummer ? { kvittonummer: rad.kvittonummer } : {}),
        ...(rad.tid ? { tid: rad.tid } : {}),
        ...(refs.get(rad.id)?.length ? { kortref: refs.get(rad.id)! } : {}),
      },
      {
        ...(rad.egen_datum === null ? {} : { datum: rad.egen_datum }),
        ...(rad.egen_belopp === null ? {} : { belopp: rad.egen_belopp }),
      },
    ),
  );

  const tillhor = new Map<string, string>();
  for (const grupp of gruppera(nycklar)) for (const medlem of grupp) tillhor.set(medlem, grupp[0]!);

  const sattGrupp = db.prepare("UPDATE receipts SET grupp = ? WHERE id = ?");
  for (const rad of rader) {
    const grupp = tillhor.get(rad.id) ?? null;
    if (grupp !== rad.grupp) sattGrupp.run(grupp, rad.id);
  }

  // De effektiva fälten skrivs sist, när varje medlem vet vilken grupp den hör till.
  for (const rad of rader) skrivEffektiva(db, rad.id, tillhor.get(rad.id) ?? null);
}

/**
 * Skriver de fält listorna faktiskt läser: röstade när kvittot står i en grupp, och
 * kvittots egna när det står ensamt.
 *
 * Ensamma kvitton röstas **inte**, och det är inte en genväg. `rosta()` väger om
 * konfidensen och bygger om alternativlistan, vilket för en enda läsning bara vore
 * att slänga bort det utvinningen redan sagt.
 */
function skrivEffektiva(db: ReceiptIndex, id: string, grupp: string | null): void {
  const medlemmar = grupp
    ? (db.prepare("SELECT egna_falt FROM receipts WHERE grupp = ? ORDER BY id").all(grupp) as { egna_falt: string }[])
    : (db.prepare("SELECT egna_falt FROM receipts WHERE id = ?").all(id) as { egna_falt: string }[]);
  if (medlemmar.length === 0) return;

  const falt = medlemmar.length > 1 ? rosta(medlemmar.map(egnaFalten)) : egnaFalten(medlemmar[0]!);
  db.prepare(
    `UPDATE receipts SET store = ?, date = ?, total = ?, currency = ?, manuella = ? WHERE id = ?`,
  ).run(
    (varde(falt, "store") as string) ?? null,
    (varde(falt, "date") as string) ?? null,
    (varde(falt, "total") as number) ?? null,
    (varde(falt, "currency") as string) ?? null,
    manuella(falt),
    id,
  );
}

export type Gruppmedlem = { id: string; capturedAt: string; segments: number };

/**
 * Gruppen ett kvitto står i, och de fält gruppen kommit fram till.
 *
 * `medlemmar` är tom när kvittot står ensamt — det vanliga. `falt` är alltid det som
 * gäller för kvittot: gruppens röstade fält, eller dess egna om det inte har någon
 * grupp. Kvittovyn ska visa samma värden som arkivlistan, och det går bara om båda
 * frågar samma ställe.
 */
export function gruppFor(db: ReceiptIndex, id: string): { grupp: string | null; medlemmar: Gruppmedlem[]; falt: Falten } | null {
  const rad = db.prepare("SELECT id, egna_falt, grupp FROM receipts WHERE id = ?").get(id) as
    | { id: string; egna_falt: string; grupp: string | null }
    | undefined;
  if (!rad) return null;
  if (!rad.grupp) return { grupp: null, medlemmar: [], falt: egnaFalten(rad) };

  const medlemmar = db
    .prepare(
      `SELECT id, captured_at AS capturedAt, segments, egna_falt FROM receipts WHERE grupp = ? ORDER BY id`,
    )
    .all(rad.grupp) as (Gruppmedlem & { egna_falt: string })[];
  return {
    grupp: rad.grupp,
    medlemmar: medlemmar.map(({ id: medlemsId, capturedAt, segments }) => ({ id: medlemsId, capturedAt, segments })),
    falt: rosta(medlemmar.map(egnaFalten)),
  };
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
  /** Gruppen kvittot står i, eller `null` när det är ensamt om sitt köp. */
  grupp: string | null;
  /** Hur många kvitton som visar det här köpet. Ett, om inget annat sagts. */
  medlemmar: number;
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

  /**
   * Skrivbordets arkiv räknar **köp**: tre bilder av samma kvitto är en rad.
   *
   * Telefonens hemskärm gör det inte, och den skillnaden är avsiktlig. Där är listan
   * ett kvitto på att bilden kom fram — fotograferar man samma papper två gånger ska
   * båda synas, annars ser den andra fångsten ut att ha misslyckats. Den ena listan
   * handlar om vad man handlat, den andra om vad man just gjort.
   */
  const perKop = !fraga.ofardiga;
  const total = (
    db
      .prepare(`SELECT COUNT(${perKop ? "DISTINCT COALESCE(r.grupp, r.id)" : "*"}) AS n ${from} WHERE ${where}`)
      .get(...params) as { n: number }
  ).n;
  const rader = db
    .prepare(
      `SELECT r.id AS id, r.date AS date, r.store AS store, r.total AS total,
              r.currency AS currency, r.captured_at AS capturedAt,
              -- Bilder är köpets bilder när raden är ett köp. Annars hade en rad som
              -- företräder tre fotografier sagt "1 bild" och sett ut att ha tappat två.
              ${perKop ? "CASE WHEN r.grupp IS NULL THEN r.segments ELSE (SELECT SUM(m.segments) FROM receipts m WHERE m.grupp = r.grupp) END" : "r.segments"} AS segments,
              r.grupp AS grupp,
              CASE WHEN r.grupp IS NULL THEN 1
                   ELSE (SELECT COUNT(*) FROM receipts m WHERE m.grupp = r.grupp) END AS medlemmar,
              length(f.text) AS tecken,
              ${fraga.q ? "snippet(receipts_fts, 0, '[', ']', '…', 12)" : "NULL"} AS snippet
         ${from} WHERE ${where}
        ORDER BY r.date DESC, r.captured_at DESC
        LIMIT ?`,
    )
    .all(...params, Math.min(Math.max(fraga.limit ?? 200, 1), 1000)) as ArkivRad[];
  return { total, receipts: perKop ? kollapsa(rader) : rader };
}

/**
 * En rad per köp.
 *
 * Kollapsningen sker här och inte i SQL, av två skäl. Det ena är sökningen: `snippet()`
 * kräver att raden själv matchat, så den rad som representerar gruppen måste vara en
 * rad frågan verkligen träffade — hade gruppen alltid företrätts av samma medlem
 * skulle en träff i ett syskonfoto tappas bort. Det andra är att villkoren redan
 * gallrat: står bara en medlem kvar efter filtren är det den som ska synas.
 *
 * Av de kvarvarande vinner den som läst mest text. Det är det fylligaste fotografiet
 * av papperet — det som oftast har både huvud och summa med.
 */
function kollapsa(rader: ArkivRad[]): ArkivRad[] {
  const bast = new Map<string, ArkivRad>();
  for (const rad of rader) {
    const nyckeln = rad.grupp ?? rad.id;
    const fanns = bast.get(nyckeln);
    if (!fanns || rad.tecken > fanns.tecken || (rad.tecken === fanns.tecken && rad.id < fanns.id)) {
      bast.set(nyckeln, rad);
    }
  }
  return [...bast.values()];
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
