/**
 * Arkivet som tjänst. All skrivning går genom den här filen, av ett skäl: ordningen
 * mellan sidecar och index får bara finnas på ett ställe, annars glöms den bort en
 * gång och då är disken och indexet oense utan att någon märker det.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexPath, receiptDir, RECEIPTS_DIR } from "./paths.js";
import { newReceipt, readSidecar, writeSidecar, type Receipt, type Segment } from "./sidecar.js";
import { saveSegment, ImageError } from "./images.js";
import { openIndex, upsert, type ReceiptIndex } from "./index-db.js";

export class ConflictError extends Error {}
export { ImageError };

export type CreateInput = { id: string; capturedAt?: string; backlog?: boolean };

export class Archive {
  private constructor(
    readonly dataDir: string,
    readonly db: ReceiptIndex,
  ) {}

  static open(dataDir: string): Archive {
    return new Archive(dataDir, openIndex(indexPath(dataDir)));
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

  /** Sidecar först, atomiskt. Indexet efteråt, och bara om sidecaren gick igenom. */
  private async persist(receipt: Receipt): Promise<void> {
    await writeSidecar(this.dataDir, receipt);
    upsert(this.db, receipt);
  }

  /**
   * Bygger indexet från disken. Det är återställningsvägen (krav 56) och samtidigt
   * konsistenstestet: ett index byggt så här ska vara identiskt med det som växt fram
   * inkrementellt. Går en sidecar inte att läsa hoppas den över och räknas — en
   * trasig fil ska inte stoppa ombyggnaden av tiotusen andra.
   */
  async reindex(): Promise<{ indexed: number; skipped: string[] }> {
    const root = join(this.dataDir, RECEIPTS_DIR);
    let entries: string[];
    try {
      entries = await readdir(root, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { indexed: 0, skipped: [] };
      throw error;
    }
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
    return { indexed, skipped };
  }

  /** Sökvägen till en fil i kvittots katalog. Namnet valideras av anroparen. */
  fileIn(id: string, name: string): string {
    return join(receiptDir(this.dataDir, id), name);
  }
}
