/**
 * HTTP-lagret för kvitton. Tunt med flit: all logik som rör ordning och idempotens
 * ligger i `Archive`, så att den inte kan kringgås av en ny rutt.
 */
import type { FastifyError, FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { Archive, ConflictError, ImageError } from "../store/archive.js";
import { InvalidIdError, isSafeFileName } from "../store/paths.js";
import { giltigt } from "../falt/datum.js";
import {
  analys,
  arkiv,
  butiker,
  count,
  ftsQuery,
  gruppFor,
  kategoriForKvitto,
  lageFor,
  ofardiga,
  ogranskatUrval,
  pendingOcrCount,
  urvalLage,
  type Sortering,
} from "../store/index-db.js";
import { OVRIGT } from "../store/kategorier.js";
import { thumbName } from "../store/paths.js";

const CONTENT_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".webp": "image/webp" };

/** Metadatan är klientens; den sparas som den kommer, men bara om den är ett objekt. */
function parseCapture(field: unknown): Record<string, unknown> | undefined {
  const value = (field as { value?: unknown } | undefined)?.value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function registerReceipts(app: FastifyInstance, archive: Archive): void {
  // Fel översätts på ett ställe i stället för i varje rutt.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof InvalidIdError) return reply.code(400).send({ error: "invalid_id", message: error.message });
    if (error instanceof ImageError) return reply.code(415).send({ error: "not_an_image", message: error.message });
    if (error instanceof ConflictError) return reply.code(409).send({ error: "conflict", message: error.message });
    app.log.error(error);
    const status = typeof error.statusCode === "number" ? error.statusCode : 500;
    return reply.code(status).send({ error: "internal", message: error.message });
  });

  app.post<{ Body: { id?: string; capturedAt?: string; backlog?: boolean } }>(
    "/api/receipts",
    async (request, reply) => {
      const { id, capturedAt, backlog } = request.body ?? {};
      if (!id) return reply.code(400).send({ error: "missing_id", message: "Klienten ska skicka en ULID som id." });
      const { receipt, created } = await archive.create({
        id,
        ...(capturedAt ? { capturedAt } : {}),
        ...(backlog === undefined ? {} : { backlog }),
      });
      // 200 vid omtag, 201 vid nytt: klienten ska kunna se skillnaden utan att gissa.
      return reply.code(created ? 201 : 200).send(receipt);
    },
  );

  app.post<{ Params: { id: string; index: string } }>(
    "/api/receipts/:id/segments/:index",
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "missing_file", message: "Bilden ska skickas som multipart." });
      const bytes = await file.toBuffer();
      // Kamerans mätvärden vid fångst — texthöjd, skärpa, om avtryckaren var automatisk.
      // De går inte att rekonstruera i efterhand, så de tas emot här och sparas som de
      // kommer. Fältet måste ligga före filen i kroppen för att vara läst när filen är det.
      const capture = parseCapture(file.fields["capture"]);
      const { segment, created } = await archive.addSegment(
        request.params.id,
        Number(request.params.index),
        bytes,
        capture,
      );
      return reply.code(created ? 201 : 200).send(segment);
    },
  );

  app.post<{ Params: { id: string }; Body: { segments?: number } }>(
    "/api/receipts/:id/complete",
    async (request, reply) => {
      const segments = request.body?.segments;
      if (typeof segments !== "number") {
        return reply.code(400).send({ error: "missing_segments", message: "Ange hur många segment kvittot har." });
      }
      return reply.send(await archive.complete(request.params.id, segments));
    },
  );

  /**
   * Arkivet. Bara klara kvitton, sorterade på kvittots eget datum — det man handlade,
   * inte det man fotograferade. `butiker` följer med så att filtret kan erbjuda de
   * butiker som faktiskt finns i stället för en lista någon skrivit i förväg.
   */
  app.get<{
    Querystring: {
      q?: string;
      butik?: string;
      fran?: string;
      till?: string;
      limit?: string;
      ofardiga?: string;
      sortera?: string;
      ordning?: string;
      kategori?: string;
    };
  }>(
    "/api/receipts",
    async (request) => {
      const { q, butik, fran, till } = request.query;
      const fritext = q?.trim() ? ftsQuery(q.trim()) : "";
      const sorterbara: Sortering[] = ["date", "store", "total", "capturedAt", "segments"];
      const sortera = sorterbara.find((k) => k === request.query.sortera);
      const svar = arkiv(archive.db, {
        ...(request.query.ofardiga === "true" ? { ofardiga: true } : {}),
        ...(sortera ? { sortera } : {}),
        ...(request.query.ordning === "asc" ? { stigande: true } : {}),
        ...(fritext ? { q: fritext } : {}),
        ...(butik?.trim() ? { butik: butik.trim() } : {}),
        ...(request.query.kategori?.trim() ? { kategori: request.query.kategori.trim() } : {}),
        ...(fran?.trim() ? { fran: fran.trim() } : {}),
        ...(till?.trim() ? { till: till.trim() } : {}),
        limit: Math.min(Math.max(Number(request.query.limit ?? 200) || 200, 1), 1000),
      });
      // Kategorierna följer med som filtrets alternativ, i den ordning som ger dem färg.
      return { ...svar, butiker: butiker(archive.db), kategorier: archive.kategorier.kategorier };
    },
  );

  /**
   * Analysen: vad pengarna gick till, per månad och per kategori.
   *
   * Perioden är tolv månader bakåt när ingen sagt något annat — det är den period
   * beställaren sa att han tänker i, och den som gör "sticker den här månaden ut"
   * till en fråga med ett svar.
   */
  app.get<{ Querystring: { fran?: string; till?: string; kategori?: string } }>("/api/analys", async (request) => {
    const idag = new Date();
    const till = request.query.till?.trim() || idag.toISOString().slice(0, 10);
    const standardFran = new Date(Date.UTC(idag.getUTCFullYear() - 1, idag.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const fran = request.query.fran?.trim() || standardFran;
    const kategori = request.query.kategori?.trim();
    return {
      ...analys(archive.db, fran, till, kategori || undefined),
      kategori: kategori || null,
      kategorier_ordning: archive.kategorier.kategorier,
    };
  });

  /** Kategorierna och butiksreglerna. Filen i arkivet är sanningen; det här är den. */
  app.get("/api/kategorier", async () => archive.kategorier);

  /**
   * En människa säger vad en butik är. Regeln gäller bakåt — det är hela skälet att
   * kategorin är härledd i stället för inskriven på varje kvitto.
   */
  app.post<{ Body: { butik?: string; kategori?: string } }>("/api/kategorier/regel", async (request, reply) => {
    const butik = request.body?.butik?.trim();
    const kategori = request.body?.kategori?.trim();
    if (!butik) return reply.code(400).send({ error: "missing_butik", message: "Ange butiken regeln gäller." });
    if (!kategori) return reply.code(400).send({ error: "missing_kategori", message: "Ange kategorin." });
    return reply.send(await archive.sattRegel(butik, kategori));
  });

  /** Kategorin för ett enskilt kvitto. `null` lämnar tillbaka det till butikens regel. */
  app.post<{ Params: { id: string }; Body: { kategori?: string | null } }>(
    "/api/receipts/:id/kategori",
    async (request, reply) => {
      const värde = request.body?.kategori;
      if (värde !== null && typeof värde !== "string") {
        return reply.code(400).send({ error: "invalid_kategori", message: "Skicka en kategori eller null." });
      }
      const kategori = värde === null ? null : värde.trim() || OVRIGT;
      return reply.send(await archive.sattKategori(request.params.id, kategori));
    },
  );

  /**
   * Kvittot, plus varför det står i aktiviteten.
   *
   * `lage` är härlett och står aldrig i sidecaren. Utan det landade den som klickat
   * på "Bilden gick knappt att läsa" på en sida där den formuleringen inte fanns
   * någonstans, och fick gissa vad som förväntades.
   *
   * `fields` är kvittots **effektiva** fält: gruppens röstade värden när flera foton
   * visar samma köp, annars kvittots egna. Sidecaren på disk bär oförändrat den här
   * bildens egen läsning — men skärmen ska inte kunna visa ett annat butiksnamn än
   * arkivlistan gör för samma köp. `egnaFalt` finns kvar för den som vill se vad just
   * det här fotografiet gav.
   */
  app.get<{ Params: { id: string } }>("/api/receipts/:id", async (request, reply) => {
    const receipt = await archive.get(request.params.id);
    if (!receipt) return reply.code(404).send({ error: "not_found" });
    const ofardigt = lageFor(archive.db, request.params.id);
    const gruppen = gruppFor(archive.db, request.params.id);
    return {
      ...receipt,
      ...(gruppen ? { fields: gruppen.falt, egnaFalt: receipt.fields } : {}),
      grupp: gruppen?.grupp ? { id: gruppen.grupp, medlemmar: gruppen.medlemmar } : null,
      // Kategorin är härledd ur butiken och står därför inte i sidecaren, utom när en
      // människa satt den på just det här kvittot.
      kategori: kategoriForKvitto(archive.db, request.params.id),
      kategorier: archive.kategorier.kategorier,
      ...(receipt.kategori ? { kategori_egen: receipt.kategori } : {}),
      lage: ofardigt?.lage ?? null,
      saknadeFalt: ofardigt?.saknadeFalt ?? [],
    };
  });

  /**
   * Ersätter en bild med ett nytt fotografi.
   *
   * `PUT`, inte `POST`: uppladdningen med samma nummer är avsiktligt en tystnad när
   * innehållet är detsamma och ett 409 när det skiljer, och den regeln skyddar mot
   * en klient som råkar skriva över sig själv. Att ersätta är något annat — en
   * människa har tittat på bilden och sagt att den inte duger — och det ska synas på
   * anropet.
   */
  app.put<{ Params: { id: string; index: string } }>(
    "/api/receipts/:id/segments/:index",
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "missing_file", message: "Bilden ska skickas som multipart." });
      const index = Number(request.params.index);
      if (!Number.isInteger(index) || index < 1 || index > 99) return reply.code(400).send({ error: "invalid_index" });
      const { segment } = await archive.ersattSegment(
        request.params.id,
        index,
        await file.toBuffer(),
        parseCapture(file.fields["capture"]),
      );
      return reply.send(segment);
    },
  );

  /** Kasserar en bild. Sista bilden går inte att ta bort — se `taBortSegment`. */
  app.delete<{ Params: { id: string; index: string } }>(
    "/api/receipts/:id/segments/:index",
    async (request, reply) => {
      const index = Number(request.params.index);
      if (!Number.isInteger(index) || index < 1 || index > 99) return reply.code(400).send({ error: "invalid_index" });
      return reply.send(await archive.taBortSegment(request.params.id, index));
    },
  );

  /**
   * En människa vrider en bild rätt.
   *
   * Bara fyra värden finns: en bild står rätt, ligger ned åt ena eller andra hållet,
   * eller står upp och ned. Att tillåta godtyckliga grader vore att erbjuda en
   * finjustering ingen bett om, och att spara ett tal som ingen kan kontrollera mot
   * papperet.
   */
  app.post<{ Params: { id: string; index: string }; Body: { rotation?: unknown } }>(
    "/api/receipts/:id/segments/:index/rotation",
    async (request, reply) => {
      const index = Number(request.params.index);
      if (!Number.isInteger(index) || index < 1 || index > 99) return reply.code(400).send({ error: "invalid_index" });
      const rotation = request.body?.rotation;
      if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
        return reply.code(400).send({ error: "invalid_rotation", message: "Vridningen ska vara 0, 90, 180 eller 270." });
      }
      return reply.send(await archive.roteraSegment(request.params.id, index, rotation));
    },
  );

  // Bilderna lämnas ut direkt ur arkivet — de är oföränderliga, så de får cachas hårt.
  app.get<{ Params: { id: string; name: string } }>("/api/receipts/:id/files/:name", async (request, reply) => {
    const { id, name } = request.params;
    if (!isSafeFileName(name)) return reply.code(400).send({ error: "invalid_name" });
    const path = archive.fileIn(id, name);
    if (!(await stat(path).catch(() => null))?.isFile()) return reply.code(404).send({ error: "not_found" });
    const ext = name.slice(name.lastIndexOf("."));
    return reply
      .type(CONTENT_TYPES[ext] ?? "application/octet-stream")
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(createReadStream(path));
  });

  app.get<{ Params: { id: string; index: string } }>(
    "/api/receipts/:id/thumbs/:index",
    async (request, reply) => {
      const index = Number(request.params.index);
      if (!Number.isInteger(index) || index < 1 || index > 99) return reply.code(400).send({ error: "invalid_index" });
      const path = archive.fileIn(request.params.id, join("derived", thumbName(index)));
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) return reply.code(404).send({ error: "not_found" });
      /**
       * Tumnageln är inte oföränderlig, och får därför inte cachas som om den vore
       * det. Vrider någon en bild byggs den om under samma namn, och en hård cache
       * hade visat den gamla riktningen i listorna tills webbläsaren tömdes. Etaggen
       * är filens tidpunkt och storlek: en omätbart billig fråga, och ett 304 när
       * ingenting hänt.
       */
      const etag = `"${Math.trunc(info.mtimeMs)}-${info.size}"`;
      if (request.headers["if-none-match"] === etag) return reply.code(304).header("etag", etag).send();
      return reply
        .type("image/webp")
        .header("cache-control", "no-cache")
        .header("etag", etag)
        .send(createReadStream(path));
    },
  );

  const FALT = new Set(["store", "date", "total", "currency"]);

  /**
   * Vad ett fält får innehålla när en människa skriver in det.
   *
   * Det fanns ingen kontroll alls, och `sdfsfdf` gick rakt in som inköpsdatum. Ett
   * maskinläst värde passerar utvinningens egna regler; ett handskrivet passerade
   * ingenting. Kontrollen hör hemma här och inte bara i formuläret — servern är den
   * som äger arkivets innehåll, och ett API som tar emot skräp gör det förr eller senare.
   */
  function ogiltigt(namn: string, value: unknown): string | null {
    if (namn === "date") {
      if (typeof value !== "string") return "Datumet ska skrivas som ÅÅÅÅ-MM-DD.";
      const träff = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (!träff) return "Datumet ska skrivas som ÅÅÅÅ-MM-DD.";
      const [, ar, manad, dag] = träff;
      if (!giltigt(Number(ar), Number(manad), Number(dag))) return `Det finns ingen ${value}.`;
      return null;
    }
    if (namn === "total") {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Beloppet ska vara ett tal.";
      if (value < 0) return "Beloppet kan inte vara negativt.";
      return null;
    }
    // Butik och valuta är fri text — men inte tom, och inte en uppsats.
    if (typeof value !== "string" || !value.trim()) return "Fältet kan inte vara tomt.";
    if (value.length > 200) return "Fältet är för långt.";
    return null;
  }

  app.post<{ Params: { id: string }; Body: { namn?: string; value?: unknown; bekraftat?: boolean } }>(
    "/api/receipts/:id/falt",
    async (request, reply) => {
      const namn = request.body?.namn;
      if (!namn || !FALT.has(namn)) {
        return reply.code(400).send({ error: "okant_falt", message: `Fältet ska vara ett av ${[...FALT].join(", ")}.` });
      }
      if (request.body?.value === undefined) {
        return reply.code(400).send({ error: "missing_value", message: "Ange vad fältet ska bli." });
      }
      const fel = ogiltigt(namn, request.body.value);
      if (fel) return reply.code(400).send({ error: "ogiltigt_varde", namn, message: fel });
      const receipt = await archive.rattaFalt(
        request.params.id,
        namn,
        request.body.value,
        request.body.bekraftat === true,
      );
      return reply.send(receipt);
    },
  );

  /**
   * Flera fält i en enda skrivning. Kvittovyn sparar hela panelen på ett tryck, och
   * tre skrivningar efter varandra vore tre chanser att krascha mitt i något
   * användaren upplevde som en handling.
   */
  app.post<{ Params: { id: string }; Body: { rattelser?: { namn?: string; value?: unknown; bekraftat?: boolean }[] } }>(
    "/api/receipts/:id/falt/flera",
    async (request, reply) => {
      const rattelser = request.body?.rattelser;
      if (!Array.isArray(rattelser) || rattelser.length === 0) {
        return reply.code(400).send({ error: "missing_rattelser", message: "Skicka minst en rättelse." });
      }
      for (const rattelse of rattelser) {
        if (!rattelse?.namn || !FALT.has(rattelse.namn)) {
          return reply
            .code(400)
            .send({ error: "okant_falt", message: `Fältet ska vara ett av ${[...FALT].join(", ")}.` });
        }
        if (rattelse.value === undefined) {
          return reply.code(400).send({ error: "missing_value", message: "Ange vad fältet ska bli." });
        }
        const fel = ogiltigt(rattelse.namn, rattelse.value);
        if (fel) return reply.code(400).send({ error: "ogiltigt_varde", namn: rattelse.namn, message: fel });
      }
      const receipt = await archive.rattaFalten(
        request.params.id,
        rattelser.map((r) => ({ namn: r.namn as string, value: r.value, bekraftat: r.bekraftat === true })),
      );
      return reply.send(receipt);
    },
  );

  /**
   * Aktiviteten: allt som inte är färdigt, med sitt läge. Ett färdigt kvitto står
   * inte här, och ingenting står här bara för att konfidensen är låg.
   */
  app.get("/api/aktivitet", async () => {
    const rader = ofardiga(archive.db);
    return { total: count(archive.db), vantar: pendingOcrCount(archive.db), receipts: rader };
  });

  const VERDICTS = new Set(["correct", "wrong", "unreadable"]);

  /**
   * Kalibreringsurvalet: hur det står, och vad som är kvar att granska.
   *
   * `dragbara` säger hur många tolkade kvitton som ännu inte är dragna. Den siffran
   * finns för att ett urval draget i går inte täcker det som kommit in i dag — och
   * skillnaden ska synas i stället för att tystna.
   */
  app.get("/api/granskning", async () => ({
    ...urvalLage(archive.db),
    receipts: ogranskatUrval(archive.db),
  }));

  app.post<{ Body: { antal?: number } }>("/api/granskning/urval", async (request, reply) => {
    const antal = request.body?.antal ?? 100;
    if (!Number.isInteger(antal) || antal < 1 || antal > 10000) {
      return reply.code(400).send({ error: "ogiltigt_antal", message: "Urvalet ska vara 1–10000 kvitton." });
    }
    return reply.send(await archive.draUrval(antal));
  });

  app.post<{
    Params: { id: string };
    Body: {
      verdict?: string;
      dwellMs?: number;
      sawImage?: boolean;
      rattelser?: { namn?: string; value?: unknown; bekraftat?: boolean }[];
    };
  }>("/api/receipts/:id/granskning", async (request, reply) => {
    const { verdict, dwellMs, sawImage, rattelser } = request.body ?? {};
    if (!verdict || !VERDICTS.has(verdict)) {
      return reply
        .code(400)
        .send({ error: "okant_utfall", message: `Utfallet ska vara ett av ${[...VERDICTS].join(", ")}.` });
    }
    const rader = Array.isArray(rattelser) ? rattelser : [];
    for (const rad of rader) {
      if (!rad?.namn || !FALT.has(rad.namn)) {
        return reply.code(400).send({ error: "okant_falt", message: `Fältet ska vara ett av ${[...FALT].join(", ")}.` });
      }
      if (rad.value === undefined) {
        return reply.code(400).send({ error: "missing_value", message: "Ange vad fältet ska bli." });
      }
    }
    const receipt = await archive.granska(
      request.params.id,
      {
        verdict: verdict as "correct" | "wrong" | "unreadable",
        ...(typeof dwellMs === "number" ? { dwellMs } : {}),
        ...(typeof sawImage === "boolean" ? { sawImage } : {}),
      },
      rader.map((r) => ({ namn: r.namn as string, value: r.value, bekraftat: r.bekraftat === true })),
    );
    return reply.send(receipt);
  });

  /**
   * Läs om bilden. Kastar texten så att kvittot hamnar i tolkningskön igen — det är
   * den dyra vägen, och den enda som hjälper när bilden lästes tecken för tecken.
   */
  app.post<{ Params: { id: string } }>("/api/receipts/:id/lasom", async (request, reply) =>
    reply.send(await archive.lasOm(request.params.id)),
  );

  /**
   * Raderar kvittot och allt som hör till det. Oåterkalleligt — bilderna finns ingen
   * annanstans. Bekräftelsen hör hemma i gränssnittet, inte i en extra parameter här.
   */
  app.delete<{ Params: { id: string } }>("/api/receipts/:id", async (request, reply) => {
    const { borttaget } = await archive.taBort(request.params.id);
    if (!borttaget) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  /** Avslutar en fångst telefonen aldrig hann avsluta, med de bilder som kom fram. */
  app.post<{ Params: { id: string } }>("/api/receipts/:id/avsluta", async (request, reply) =>
    reply.send(await archive.avsluta(request.params.id)),
  );

  /** En människa konstaterar att en utlovad bild är borta. Förlusten skrivs ned. */
  app.post<{ Params: { id: string } }>("/api/receipts/:id/bilder-borta", async (request, reply) =>
    reply.send(await archive.bilderBorta(request.params.id)),
  );

  app.post("/api/reindex", async () => archive.reindex());

  // Omtolkning är inte samma sak som omindexering. `reindex` bygger om det härledda
  // indexet ur sidecarerna; det här räknar om *fälten* ur texten som redan lästs, och
  // är vägen att låta förbättrade regler nå kvitton som tolkades i går.
  app.post("/api/falt/omtolka", async () => archive.reextract());
}
