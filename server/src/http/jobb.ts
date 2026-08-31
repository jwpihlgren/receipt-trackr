/**
 * Utdelningen av tolkningsjobb.
 *
 * Rutterna är avsiktligt dumma. All ordning ligger i `Reservationer` och i `Archive`,
 * och servern tar aldrig initiativ: den svarar på frågan "finns det något att göra",
 * lämnar ut det som är ledigt, och tar emot svaret. Att telefonen frågar av sig själv
 * och datorn bara när någon trycker är ett beslut som fattas i klienten, och det ska
 * inte gå att läsa av här.
 */
import type { FastifyInstance } from "fastify";
import type { Archive } from "../store/archive.js";
import { pendingOcr, pendingOcrCount } from "../store/index-db.js";
import type { Reservationer } from "../jobb.js";

export type Jobb = {
  id: string;
  capturedAt: string;
  segments: {
    index: number;
    file: string;
    sha256: string;
    /**
     * Vad en människa sagt om bildens riktning. Finns den väger den tyngre än allt
     * annat: klienten vrider bilden så och hoppar över sin egen gissning, som kostar
     * 500–700 ms och i M0 hade fel på en bild av trettiofem.
     */
    rotation?: 0 | 90 | 180 | 270;
  }[];
  reservationTill: number;
  /**
   * Sant när varje bild kom från appens egen fångst. Då är orienteringen redan inbakad
   * i pixlarna och klienten kan hoppa över uppräteningen — mätt i M5a till 500–700 ms
   * per bild, för att upptäcka att allt redan står rätt (vridna 0/17).
   */
  uppratt: boolean;
};

export function registerJobb(app: FastifyInstance, archive: Archive, reservationer: Reservationer): void {
  app.get("/api/jobb", async () => ({
    vantande: pendingOcrCount(archive.db),
    reserverade: reservationer.antal(),
    // Vilka **slag** av enheter som arbetar, aldrig vilka enheter. Klienten ska kunna
    // säga "telefonen läser dem" utan att servern håller ett register över apparater.
    enheter: reservationer.slag(),
  }));

  app.post<{ Body: { antal?: number; arbetare?: string; id?: string } }>("/api/jobb/hamta", async (request, reply) => {
    const arbetare = request.body?.arbetare?.trim();
    if (!arbetare) {
      return reply.code(400).send({ error: "missing_arbetare", message: "Klienten ska säga vem den är." });
    }
    const antal = Math.min(Math.max(Number(request.body?.antal ?? 1) || 1, 1), 5);

    // Ett `id` betyder "just det här kvittot, nu". Det är vad *Läs om bilden* gör: en
    // människa har pekat på ett kvitto och ska inte behöva vänta på att kön råkar
    // komma dit. Kön i övrigt fungerar likadant — utdelningen är fortfarande serverns
    // enda uppgift, och det är fortfarande klienten som räknar.
    const onskat = request.body?.id?.trim();
    const kandidater = onskat
      ? pendingOcr(archive.db, 1000).filter((k) => k.id === onskat && !reservationer.reserverad(k.id))
      : // Hämtar fler kandidater än som ska delas ut: några av dem är redan reserverade.
        pendingOcr(archive.db, antal * 4).filter((k) => !reservationer.reserverad(k.id));
    const givna = reservationer.reservera(
      kandidater.slice(0, onskat ? 1 : antal).map((k) => k.id),
      arbetare,
    );

    const jobb: Jobb[] = [];
    for (const { id, till } of givna) {
      const receipt = await archive.get(id);
      if (!receipt) {
        // Kvittot finns i indexet men inte på disk. Indexet är härlett — släpp
        // reservationen och låt `reindex` städa; ett jobb ska inte fastna på det.
        reservationer.slapp(id);
        continue;
      }
      jobb.push({
        id,
        capturedAt: receipt.capturedAt,
        segments: receipt.segments.map((s, i) => ({
          index: i + 1,
          file: s.file,
          sha256: s.sha256,
          ...(s.rotation ? { rotation: s.rotation } : {}),
        })),
        reservationTill: till,
        uppratt:
          receipt.segments.length > 0 &&
          receipt.segments.every((s) => (s.capture as { source?: unknown } | undefined)?.source === "systemkamera"),
      });
    }
    return { jobb };
  });

  app.post<{ Params: { id: string }; Body: { text?: string; ocr?: unknown } }>(
    "/api/jobb/:id",
    async (request, reply) => {
      const text = request.body?.text;
      if (typeof text !== "string") {
        return reply.code(400).send({ error: "missing_text", message: "Skicka den utlästa texten." });
      }
      // Reservationen kontrolleras inte: en klient som hunnit läsa klart efter att
      // reservationen gått ut har ändå gjort arbetet, och att kasta det vore dumt.
      // Två klienter som lämnar samma svar skriver samma sak, i tur och ordning.
      const receipt = await archive.saveOcr(request.params.id, text, request.body?.ocr ?? null);
      reservationer.slapp(request.params.id);
      return reply.send({ id: receipt.id, tecken: text.length });
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { arbetare?: string } }>(
    "/api/jobb/:id",
    async (request, reply) => {
      const arbetare = request.query.arbetare?.trim();
      if (!arbetare) return reply.code(400).send({ error: "missing_arbetare" });
      const slapptes = reservationer.aterlamna(request.params.id, arbetare);
      return reply.code(slapptes ? 204 : 409).send();
    },
  );
}
