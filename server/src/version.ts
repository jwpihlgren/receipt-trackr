import { readFileSync } from "node:fs";

/** Läses ur package.json så att versionen bara finns på ett ställe. */
function read(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = read();
