/**
 * Diskkontrollen som planen kallar "tio rader som förhindrar det enda felet som kan
 * ta ner hela maskinen": en backloggkörning mot bootenheten fyller den.
 *
 * Två frågor besvaras här och loggas vid start: *var* ligger $DATA_DIR egentligen
 * (vilken monteringspunkt), och hur mycket är ledigt där. Monteringspunkten är med
 * därför att felet nästan aldrig ser ut som slut på utrymme — det ser ut som att
 * katalogen finns, vilket den gör, fast på fel disk.
 */
import { statfs } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";

export type DiskReport = {
  /** Sökvägen som faktiskt kontrollerades, efter symlänkar. */
  path: string;
  /** Monteringspunkten sökvägen ligger på, eller null när /proc/mounts inte går att läsa. */
  mount: string | null;
  /** Filsystemets typ på den monteringspunkten, t.ex. "zfs" eller "ext4". */
  filesystem: string | null;
  freeBytes: number;
  totalBytes: number;
};

/**
 * Slår upp monteringspunkten genom längsta prefixmatchning i /proc/mounts. Linux-
 * specifikt, vilket är precis vad målet är — misslyckas det svarar vi null i stället
 * för att kasta, eftersom utrymmeskontrollen inte får falla på en trevlighet.
 */
export async function findMount(path: string): Promise<Pick<DiskReport, "mount" | "filesystem">> {
  let mounts: string;
  try {
    mounts = await readFile("/proc/mounts", "utf8");
  } catch {
    return { mount: null, filesystem: null };
  }
  let best: { mount: string; filesystem: string } | null = null;
  for (const line of mounts.split("\n")) {
    const [, rawMount, filesystem] = line.split(" ");
    if (!rawMount || !filesystem) continue;
    // /proc/mounts oktal-escapar mellanslag och liknande.
    const mount = rawMount.replace(/\\(\d{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
    const isPrefix = path === mount || path.startsWith(mount === "/" ? "/" : `${mount}/`);
    if (isPrefix && (!best || mount.length > best.mount.length)) best = { mount, filesystem };
  }
  return best ?? { mount: null, filesystem: null };
}

export async function inspectDisk(path: string): Promise<DiskReport> {
  const real = await realpath(path);
  const stats = await statfs(real);
  // bavail, inte bfree: det som är ledigt för en vanlig användare, inte inklusive
  // blocken som är reserverade för root. Det är den siffran en körning tar av.
  return {
    path: real,
    ...(await findMount(real)),
    freeBytes: Number(stats.bavail) * Number(stats.bsize),
    totalBytes: Number(stats.blocks) * Number(stats.bsize),
  };
}
