import { MemoryKvStore } from "@fedify/fedify";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/node-sqlite";
import type { Platform } from "./types";

/**
 * A plain Node process.
 *
 * The only file allowed to import `node:*`. It exists first to prove the
 * boundary: an interface with one implementation is a claim about portability,
 * not evidence of it — writing the second one is what tests whether the seam
 * was drawn in the right place.
 *
 * Deliberately the simplest thing that satisfies the interface. Durable records
 * are files; there is no queue. A real deployment would reach for
 * @fedify/sqlite, which supplies both from one file — and would then have
 * retries, which the Workers side still lacks.
 */
const DIR = process.env.AP_DATA_DIR ?? ".data";
const path = (key: string) => join(DIR, `${key.replace(/[^\w.-]/g, "_")}.json`);

const platform = {} as Platform;

platform.kv = new MemoryKvStore();

// No queue. `false` is the honest answer, and it is the same answer the
// Workers side gives when its binding is absent.
platform.queue = false;

// One file beside the JSON records. node:sqlite is built in, so the second
// driver costs no dependency. AP_DB_URL moves the file; a different dialect
// would be a different platform, which is the line this seam draws.
platform.db = drizzle({
  client: new DatabaseSync(process.env.AP_DB_URL ?? join(DIR, "interactions.sqlite")),
});

platform.secret = (name) => process.env[name];

platform.get = async <T>(key: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path(key), "utf8")) as T;
  } catch {
    return null;
  }
};

platform.put = async (key: string, value: unknown): Promise<void> => {
  const file = path(key);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};

export { platform };
