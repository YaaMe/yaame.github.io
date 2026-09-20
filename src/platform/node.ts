import { MemoryKvStore } from "@fedify/fedify";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/node-sqlite";
import type { Platform } from "./types";

/**
 * A plain Node process.
 *
 * The only file allowed to import `node:*`.
 *
 * Deliberately the simplest thing that satisfies the interface: durable records
 * are files, and there is no queue — so delivery here is synchronous and a
 * failure is final.
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

// `ttl` is dropped: nothing here sweeps files. A record that expires says so
// in its own contents, and the reader is what enforces it.
platform.put = async (key: string, value: unknown): Promise<void> => {
  const file = path(key);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};

platform.remove = async (key: string): Promise<void> => {
  await rm(path(key), { force: true });
};

export { platform };
