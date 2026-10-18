import { join } from "node:path";

/** Map one logical node record key to its JSON file. */
export function recordFile(dir: string, key: string): string {
  return join(dir, `${key.replace(/[^\w.-]/g, "_")}.json`);
}
