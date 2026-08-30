/**
 * Arkivet som tjänst. All skrivning går genom den här filen, av ett skäl: ordningen
 * mellan sidecar och index får bara finnas på ett ställe, annars glöms den bort en
 * gång och då är disken och indexet oense utan att någon märker det.
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { indexPath, receiptDir, RECEIPTS_DIR } from "./paths.js";
import { newReceipt, readSidecar, writeSidecar, type Receipt, type Segment, type Verdict } from "./sidecar.js";
import { saveSegment, ImageError } from "./images.js";
import { dragbara, openIndex, remove, rensaAldreAn, upsert, type ReceiptIndex } from "./index-db.js";
import { utvinnUtanAttSkrivaOver, type Falten } from "../falt/index.js";

export class ConflictError extends Error {}
export { ImageError };

export type CreateInput = { id: string; capturedAt?: string; backlog?: boolean };

/** En människas ord om ett fält: antingen ett nytt värde, eller att det gamla dög. */
export type Rattelse = { namn: string; value: unknown; bekraftat: boolean };

export class Archive {
  private constructor(
    readonly dataDir: string,
    readonly db: ReceiptIndex,
    /**
     * Sant när indexets schema var ett annat än kodens och tabellerna därför kastades.
     * Den som öppnar arkivet ansvarar för att köra `reindex` — indexet är tomt tills
     * dess, och ett tomt index är inte ett fel utan ett obesvarat anrop.
     */
    readonly indexRebuilt: boolean,
  ) {}

  static open(dataDir: string): Archive {
    const { db, rebuilt } = openIndex(indexPath(dataDir));
    return new Archive(dataDir, db, rebuilt);
  }

  close(): void {
    this.db.close();
  }

  get(id: string): Promise<Receipt | null> {
    return readSidecar(this.dataDir, id);
  }

  /**
   * Idempotent (krav 3): ULID:en kommer från klienten, så ett omtaget anrop efter en
   * tappad uppkoppling träffar samma kvitto i stället för att skapa ett andra. Därför
   * svarar den också med om kvittot var nytt — klienten ska kunna skilja på "skapat"
   * och "fanns redan" utan att gissa på statuskoder.
   */
  async create(input: CreateInput): Promise<{ receipt: Receipt; created: boolean }> {
    const existing = await this.get(input.id);
    if (existing) return { receipt: existing, created: false };

    const receipt = newReceipt(input.id, input.capturedAt ?? new Date().toISOString(), input.backlog ?? false);
    await this.persist(receipt);
    return { receipt, created: true };
  }

  /**
   * Segmentets nummer bestäms av klienten, inte av ankomstordningen: bara så kan ett
   * omtaget anrop skriva över sig självt i stället för att lägga till en dubblett.
   * Samma nummer med samma innehåll är en tystnad; samma nummer med annat innehåll
   * är ett fel som ska synas, inte en tyst överskrivning av ett original.
   */
  async addSegment(
    id: string,
    index: number,
    bytes: Buffer,
    capture?: Record<string, unknown>,
  ): Promise<{ receipt: Receipt; segment: Segment; created: boolean }> {
    if (!Number.isInteger(index) || index < 1 || index > 99) {
      throw new ConflictError(`Segmentnummer ska vara 1–99, inte ${index}.`);
    }
    const receipt = await this.get(id);
    if (!receipt) throw new ConflictError(`Kvittot ${id} finns inte. Skapa det först.`);

    const segment = await saveSegment(this.dataDir, id, index, bytes, capture);
    const existing = receipt.segments.find((s) => s.file === segment.file);
    if (existing) {
      if (existing.sha256 !== segment.sha256) {
        throw new ConflictError(
          `Segment ${index} finns redan med ett annat innehåll. Bilderna är oåterkalleliga — ` +
            `ett nytt segment ska ha ett nytt nummer.`,
        );
      }
      return { receipt, segment: existing, created: false };
    }

    receipt.segments = [...receipt.segments, segment].sort((a, b) => a.file.localeCompare(b.file));
    await this.persist(receipt);
    return { receipt, segment, created: true };
  }

  /**
   * Klienten säger att kvittot är färdigfångat och hur många segment det har. Först
   * då vet servern om något saknas — och först då får textutläsningen starta, för ett
   * kvitto vars sista segment bär totalbeloppet får inte tolkas halvt.
   */
  async complete(id: string, segments: number): Promise<Receipt> {
    const receipt = await this.get(id);
    if (!receipt) throw new ConflictError(`Kvittot ${id} finns inte.`);
    if (!Number.isInteger(segments) || segments < 1 || segments > 99) {
      throw new ConflictError(`Antalet segment ska vara 1–99, inte ${segments}.`);
    }
    // Ett högre antal är "jag glömde sista biten" och måste gå igenom — det är
    // flödets vanligaste misstag och det kostar totalbeloppet. Ett lägre antal är
    // motsatsen: ett sätt att få ett halvt kvitto att se komplett ut, och avvisas.
    if (receipt.expectedSegments !== null && segments < receipt.expectedSegments) {
      throw new ConflictError(
        `Kvittot är avslutat med ${receipt.expectedSegments} bilder och kan inte minskas till ${segments}. ` +
          `Ett kvitto som redan sagts vara helt får inte bli mindre.`,
      );
    }
    if (receipt.expectedSegments === segments) return receipt;

    receipt.expectedSegments = segments;
    receipt.completedAt = new Date().toISOString();
    await this.persist(receipt);
    return receipt;
  }

  /**
   * Avslutar fångsten från datorn, med det antal bilder som faktiskt kom fram.
   *
   * Telefonen säger normalt själv hur många bilder ett kvitto har. Vräks fliken ur
   * minnet medan kameran ligger i förgrunden sägs det aldrig, och kvittot blev
   * tidigare stående i aktiviteten för alltid — det fanns ingen väg att avsluta det
   * någon annanstans ifrån.
   */
  async avsluta(id: string): Promise<Receipt> {
    const receipt = await this.get(id);
    if (!receipt) throw new ConflictError(`Kvittot ${id} finns inte i arkivet.`);
    if (receipt.segments.length === 0) {
      throw new ConflictError(`Kvittot ${id} har inga bilder och kan inte avslutas.`);
    }
    if (receipt.expectedSegments !== null) return receipt;
    receipt.expectedSegments = receipt.segments.length;
    receipt.completedAt = new Date().toISOString();
    await this.persist(receipt);
    return receipt;
  }

  /**
   * En människa konstaterar att en utlovad bild är borta.
   *
   * `complete` vägrar med flit att minska antalet — det skulle låta ett halvt kvitto
   * se helt ut. Men en människa som tittat och sagt "den kommer inte" är något annat
   * än en klient som räknat fel, och utan den här vägen kunde kvittot bara raderas.
   * Förlusten skrivs ned i sidecaren i stället för att tystna.
   */
  async bilderBorta(id: string): Promise<Receipt> {
    const receipt = await this.get(id);
    if (!receipt) throw new ConflictError(`Kvittot ${id} finns inte i arkivet.`);
    const faktiska = receipt.segments.length;
    if (faktiska === 0) throw new ConflictError(`Kvittot ${id} har inga bilder alls.`);
    if (receipt.expectedSegments === null || receipt.expectedSegments <= faktiska) return receipt;

    receipt.lostSegments = {
      at: new Date().toISOString(),
      utlovade: receipt.expectedSegments,
      faktiska,
    };
    receipt.expectedSegments = faktiska;
    await this.persist(receipt);
    return receipt;
  }

  /** Sidecar först, atomiskt. Indexet efteråt, och bara om sidecaren gick igenom. */
  private async persist(receipt: Receipt): Promise<void> {
    await writeSidecar(this.dataDir, receipt);
    upsert(this.db, receipt);
  }

  /**
   * Raderar ett kvitto och allt som hör till det: bilderna, sidecaren, tumnaglarna.
   *
   * **Oåterkalleligt.** Bilderna är sanningen i det här arkivet och finns ingen
   * annanstans; papperet är för länge sedan slängt. Det finns ingen papperskorg, för
   * en dold sådan hade varit att svara något annat än det som efterfrågades.
   *
   * Ordningen är omvänd mot all annan skrivning här, och det är avsiktligt: indexet
   * först, filerna sedan. Kraschar det däremellan ligger bilderna kvar utan rad i
   * indexet, och `reindex` tar tillbaka dem — en misslyckad radering. Görs det åt
   * andra hållet blir följden i stället en rad som pekar på filer som inte finns.
   * Av de två felen är det första det harmlösa.
   */
  async taBort(id: string): Promise<{ borttaget: boolean }> {
    const receipt = await this.get(id);
    if (!receipt) return { borttaget: false };
    remove(this.db, id);
    await rm(receiptDir(this.dataDir, id), { recursive: true, force: true });
    return { borttaget: true };
  }

  /**
   * Bygger indexet från disken. Det är återställningsvägen (krav 56) och samtidigt
   * konsistenstestet: ett index byggt så här ska vara identiskt med det som växt fram
   * inkrementellt. Går en sidecar inte att läsa hoppas den över och räknas — en
   * trasig fil ska inte stoppa ombyggnaden av tiotusen andra.
   */
  async reindex(): Promise<{ indexed: number; skipped: string[]; rensade: number }> {
    const root = join(this.dataDir, RECEIPTS_DIR);
    let entries: string[];
    try {
      entries = await readdir(root, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { indexed: 0, skipped: [], rensade: 0 };
      throw error;
    }
    const start = new Date().toISOString();
    const skipped: string[] = [];
    let indexed = 0;
    for (const entry of entries) {
      if (!entry.endsWith("receipt.json")) continue;
      try {
        const receipt = JSON.parse(await readFile(join(root, entry), "utf8")) as Receipt;
        upsert(this.db, receipt);
        indexed++;
      } catch {
        skipped.push(entry);
      }
    }
    // Rader vars kvitto inte längre finns kvar på disken städas bort. Utan det skulle
    // ett raderat kvitto överleva i listorna som en rad som ger 404 när man klickar.
    const rensade = rensaAldreAn(this.db, start);
    return { indexed, skipped, rensade };
  }

  /**
   * Skriver in tolkningen. Samma ordning som allt annat: sidecar först, index efteråt.
   *
   * `text` är råtexten som söks i; `ocr` är hela utfallet — rad för rad med konfidens,
   * vilken modell som läste, och hur uppräteningen gick. Det senare är inte prydnad:
   * en bild som lästes tecken för tecken ska gå att hitta i efterhand, och konfidensen
   * per rad är det granskningsurvalet vilar på.
   */
  async saveOcr(id: string, text: string, ocr: unknown): Promise<Receipt> {
    const receipt = await this.get(id);
    if (!receipt) throw new ConflictError(`Kvittot ${id} finns inte i arkivet.`);
    receipt.text = text;
    receipt.ocr = ocr;
    // Fälten faller ut ur texten direkt. Utvinningen är några reguljära uttryck och
    // lite räkning — den hör hemma här och inte i ett andra steg någon måste komma
    // ihåg att starta.
    receipt.fields = utvinnUtanAttSkrivaOver(text, receipt.capturedAt, receipt.fields as Falten);
    await this.persist(receipt);
    return receipt;
  }

  /**
   * En människa rättar eller bekräftar ett fält.
   *
   * Bekräftelsen skriver också en post i `corrections`, med samma värde före och efter.
   * Det ser onödigt ut men är hela mätningen: utan en post för "maskinen hade rätt" går
   * det inte att skilja ett fält ingen tittat på från ett någon granskat och godkänt,
   * och då säger felfrekvensen ingenting.
   */
  rattaFalt(id: string, namn: string, value: unknown, bekraftat: boolean): Promise<Receipt> {
    return this.rattaFalten(id, [{ namn, value, bekraftat }]);
  }

  /**
   * Flera fält i ett svep, och avsiktligt i **en** skrivning.
   *
   * Rättningspasset sparar hela kvittot på ett tryck, och tre skrivningar efter
   * varandra vore tre chanser att krascha mitt i något som användaren upplevde som en
   * handling. De delar också tidsstämpel: posterna i `corrections` beskriver ett enda
   * ögonblick, för det var vad det var.
   */
  async rattaFalten(id: string, rattelser: Rattelse[]): Promise<Receipt> {
    const receipt = await this.get(id);
    if (!receipt) throw new ConflictError(`Kvittot ${id} finns inte i arkivet.`);
    if (rattelser.length === 0) return receipt;

    this.tillampa(receipt, rattelser);
    await this.persist(receipt);
    return receipt;
  }

  /** Ändrar kvittot i minnet. Anroparen skriver — så att ett tryck blir en skrivning. */
  private tillampa(receipt: Receipt, rattelser: Rattelse[]): void {
    const at = new Date().toISOString();
    const falten = receipt.fields as Record<string, { value?: unknown; confidence?: number } | undefined>;
    for (const { namn, value, bekraftat } of rattelser) {
      const falt = falten[namn];
      receipt.corrections = [
        ...receipt.corrections,
        {
          at,
          field: namn,
          from: falt?.value ?? null,
          to: value,
          fromConfidence: falt?.confidence ?? null,
          action: bekraftat ? "confirmed" : "corrected",
        },
      ];
      falten[namn] = {
        value,
        // En människa som tittat på bilden är inte 90 % säker, hon vet.
        confidence: 1,
        source: bekraftat ? "confirmed" : "manual",
      } as { value?: unknown; confidence?: number };
    }
  }

  /**
   * Drar kalibreringsurvalet — slumpmässigt, och **oberoende av konfidens**.
   *
   * Det sista är hela poängen och tål att stå i klartext: ett kvitto hamnar aldrig i
   * granskningskön för att det ser osäkert ut. Ett fält som blev fel med hög konfidens
   * dyker annars aldrig upp av sig självt, och felfrekvensen man räknar fram blir en
   * siffra över det man råkat snubbla på i stället för över högen.
   *
   * `antal` är urvalets *måttstorlek*, inte hur många som dras nu: har tio kvitton
   * redan dragits och man ber om hundra, dras nittio till. Finns det färre tolkade
   * kvitton än så dras alla som finns — vilket är läget i ett litet arkiv, och inte
   * ett fel utan en följd av att slumpen bara har mening när högen är större än vad
   * man orkar granska.
   */
  async draUrval(antal: number): Promise<{ dragna: number; urval: number; kvarAttDra: number }> {
    const kandidater = dragbara(this.db);
    const redan = (this.db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE sampled = 1").get() as { n: number }).n;
    const behovs = Math.max(0, antal - redan);

    // Fisher–Yates, och bara så långt som behövs.
    for (let i = kandidater.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [kandidater[i], kandidater[j]] = [kandidater[j]!, kandidater[i]!];
    }

    const dragna = kandidater.slice(0, behovs);
    for (const id of dragna) {
      const receipt = await this.get(id);
      if (!receipt) continue;
      receipt.review = { ...receipt.review, sampled: true };
      await this.persist(receipt);
    }
    return {
      dragna: dragna.length,
      urval: redan + dragna.length,
      kvarAttDra: Math.max(0, kandidater.length - dragna.length),
    };
  }

  /**
   * Skriver ett granskningsutfall, och de rättelser som hörde till samma blick, i en
   * enda skrivning. Utfallet och rättelserna beskriver ett ögonblick och ska inte
   * kunna skiljas åt av en krasch däremellan.
   *
   * `sampled` rörs inte. Granskar någon ett kvitto som aldrig drogs ska det utfallet
   * bevaras men **inte** räknas in i kalibreringen — och den skillnaden går bara att
   * hålla om draget och granskningen är två skilda fakta på disken.
   */
  async granska(
    id: string,
    utfall: { verdict: Verdict; dwellMs?: number; sawImage?: boolean },
    rattelser: Rattelse[] = [],
  ): Promise<Receipt> {
    const receipt = await this.get(id);
    if (!receipt) throw new ConflictError(`Kvittot ${id} finns inte i arkivet.`);
    if (rattelser.length > 0) this.tillampa(receipt, rattelser);
    receipt.review = {
      ...receipt.review,
      reviewedAt: new Date().toISOString(),
      verdict: utfall.verdict,
      ...(utfall.dwellMs === undefined ? {} : { dwellMs: utfall.dwellMs }),
      ...(utfall.sawImage === undefined ? {} : { sawImage: utfall.sawImage }),
    };
    await this.persist(receipt);
    return receipt;
  }

  /**
   * Lägger tillbaka kvittot i tolkningskön genom att kasta det härledda.
   *
   * Ofarligt av samma skäl som allt annat här: bilderna är sanningen, texten är
   * härledd. Fälten står kvar — en människas rättelse ska överleva en omläsning, och
   * maskinens egna värden skrivs över av sig själva när den nya texten kommer.
   */
  async lasOm(id: string): Promise<Receipt> {
    const receipt = await this.get(id);
    if (!receipt) throw new ConflictError(`Kvittot ${id} finns inte i arkivet.`);
    receipt.text = "";
    receipt.ocr = null;
    await this.persist(receipt);
    return receipt;
  }

  /**
   * Räknar om fälten ur texten som redan finns, för alla kvitton.
   *
   * Det här är hela vinsten med att utvinningen bor på servern: blir reglerna bättre
   * får varje kvitto nytta av det utan att en enda bild läses om. Rättelser står kvar
   * — se `utvinnUtanAttSkrivaOver`, som är den regel som gör en omtolkning ofarlig.
   */
  async reextract(): Promise<{ omtolkade: number; utanText: number }> {
    const root = join(this.dataDir, RECEIPTS_DIR);
    // Samma vandring som `reindex`: katalogen är partitionerad på år, så nivån under
    // roten är inte ett kvitto-id utan ett årtal.
    const entries = await readdir(root, { recursive: true }).catch(() => [] as string[]);

    let omtolkade = 0;
    let utanText = 0;
    for (const entry of entries) {
      if (!entry.endsWith("receipt.json")) continue;
      let receipt: Receipt;
      try {
        receipt = JSON.parse(await readFile(join(root, entry), "utf8")) as Receipt;
      } catch {
        continue;
      }
      if (!receipt.text?.trim()) {
        utanText++;
        continue;
      }
      receipt.fields = utvinnUtanAttSkrivaOver(receipt.text, receipt.capturedAt, receipt.fields as Falten);
      await this.persist(receipt);
      omtolkade++;
    }
    return { omtolkade, utanText };
  }

  /** Sökvägen till en fil i kvittots katalog. Namnet valideras av anroparen. */
  fileIn(id: string, name: string): string {
    return join(receiptDir(this.dataDir, id), name);
  }
}
