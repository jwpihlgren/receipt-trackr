/**
 * Backupjobbet med framdrift. Ett i taget: två samtidiga kopieringar mot samma
 * katalog skulle bara slåss om disken, och den som tittar vill se ett förlopp, inte
 * två. Tillståndet lever i processen — går servern ner mitt i en kopiering är kopian
 * ofullständig men inte trasig, och nästa körning fortsätter där den är.
 */
import { mirror, verify, readManifest, type Progress, type VerifyResult } from "./mirror.js";
import { join } from "node:path";

export type BackupState =
  | { state: "idle"; last: BackupSummary | null }
  | { state: "running"; startedAt: string; progress: Progress; last: BackupSummary | null };

export type BackupSummary = {
  finishedAt: string;
  ok: boolean;
  durationMs: number;
  files: number;
  copied: number;
  skipped: number;
  bytes: number;
  receipts: number;
  manifest: string;
  verify?: VerifyResult;
  error?: string;
};

export class BackupJob {
  private running: { startedAt: string; progress: Progress } | null = null;
  private last: BackupSummary | null = null;

  constructor(
    private readonly dataDir: string,
    readonly backupDir: string,
  ) {}

  status(): BackupState {
    return this.running
      ? { state: "running", startedAt: this.running.startedAt, progress: this.running.progress, last: this.last }
      : { state: "idle", last: this.last };
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /**
   * Kopierar och kontrollerar sedan kopian mot manifestet i samma körning. Att
   * kontrollen ingår är avsiktligt: en backup som rapporteras klar utan att någon
   * läst tillbaka filerna är precis den sortens trygghet som sviker när den behövs.
   */
  async run(): Promise<BackupSummary> {
    if (this.running) throw new Error("En säkerhetskopiering pågår redan.");
    const startedAt = new Date().toISOString();
    const started = Date.now();
    this.running = { startedAt, progress: { files: 0, copied: 0, bytes: 0, receipts: 0 } };
    try {
      const result = await mirror(this.dataDir, this.backupDir, (progress) => {
        if (this.running) this.running.progress = progress;
      });
      const check = await verify(this.backupDir, result.manifest);
      this.last = {
        finishedAt: new Date().toISOString(),
        ok: check.ok,
        durationMs: Date.now() - started,
        files: result.manifest.files,
        copied: result.copied,
        skipped: result.skipped,
        bytes: result.manifest.bytes,
        receipts: result.manifest.receipts,
        manifest: result.manifestPath,
        verify: check,
      };
    } catch (error) {
      this.last = {
        finishedAt: new Date().toISOString(),
        ok: false,
        durationMs: Date.now() - started,
        files: 0,
        copied: 0,
        skipped: 0,
        bytes: 0,
        receipts: 0,
        manifest: "",
        error: (error as Error).message,
      };
    } finally {
      this.running = null;
    }
    return this.last;
  }

  /** Kontrollerar en katalog mot senaste manifestet — kopian, eller arkivet efter en återställning. */
  async verifyAgainstManifest(dir: string = this.backupDir): Promise<VerifyResult> {
    return verify(dir, await readManifest(join(this.backupDir, "MANIFEST.json")));
  }
}
