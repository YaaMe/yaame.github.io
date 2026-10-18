import { join } from "node:path";

export function databaseFile(dataDir: string, override?: string): string {
  return override ?? join(dataDir, "interactions.sqlite");
}
