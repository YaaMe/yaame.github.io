import { MemoryKvStore } from "@fedify/fedify";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Platform, SqlValue } from "./types";

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
// implementation of this seam costs no dependency — which is the whole argument
// for choosing SQLite over anything that is a service rather than a library.
//
// Opened once and kept: DatabaseSync is synchronous, and the async signature
// exists only because D1's is.
const db = new DatabaseSync(join(DIR, "interactions.sqlite"));

platform.sql = {
  all: async <T>(sql: string, ...params: SqlValue[]) =>
    db.prepare(sql).all(...params) as T[],
  first: async <T>(sql: string, ...params: SqlValue[]) =>
    (db.prepare(sql).get(...params) as T | undefined) ?? null,
  run: async (sql: string, ...params: SqlValue[]) =>
    Number(db.prepare(sql).run(...params).changes),
  batch: async (statements) => {
    db.exec("BEGIN");
    try {
      for (const s of statements) db.prepare(s.sql).run(...s.params);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },
};

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
