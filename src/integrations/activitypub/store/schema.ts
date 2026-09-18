/**
 * Every statement that touches the database, in one file.
 *
 * Kept together so the dialect stays reviewable: this is SQLite because D1 is,
 * and moving to anything else later is only cheap while the statements are
 * conservative and countable. Nothing here uses a SQLite-only function, a join,
 * or full-text search — search is a build-time concern over git, not a query
 * (docs/interactions.md).
 *
 * Times are ISO 8601 strings. SQLite has no date type, and every dialect reads
 * an ISO string the same way; a numeric epoch would be smaller and would have
 * to be decoded by hand in every place that reads it.
 */
import type { SqlStore } from "../../../platform/types";

/**
 * Applied in order, never edited once shipped.
 *
 * Editing a migration that has run somewhere leaves two databases claiming the
 * same version with different shapes, and nothing reports it. To change the
 * schema, append.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE comments (
     -- The activity's id, not the object's. ActivityPub §5.2 requires
     -- de-duplication by activity id, so this is a constraint rather than an
     -- index: a redelivered activity must be rejected by the database, not by
     -- whoever remembered to check.
     activity_id TEXT PRIMARY KEY,

     -- The Note itself, which is what a Delete names and what a reply points at.
     object_id   TEXT NOT NULL UNIQUE,

     -- The top of the thread — usually one of our own posts. Stored rather than
     -- walked, so "everything under this post" is one indexed read instead of a
     -- recursive climb on every render.
     root_id     TEXT NOT NULL,

     -- The direct parent, null when the reply is to the root itself.
     reply_to_id TEXT,

     actor_id    TEXT NOT NULL,
     content     TEXT NOT NULL,
     published   TEXT NOT NULL,
     received_at TEXT NOT NULL,

     -- Set when a Delete arrives. The row stays: we still owe a record of what
     -- was here, and a promoted comment needs one to raise a removal against.
     deleted_at  TEXT,

     -- Set when this comment has been carried into git, which is the point it
     -- stops being ours to erase.
     promoted_at TEXT
   )`,
  `CREATE INDEX comments_by_thread ON comments (root_id, published)`,
  `CREATE INDEX comments_by_actor ON comments (actor_id, published)`,
];

/**
 * Bring a database up to the current schema.
 *
 * Written here rather than delegated to `wrangler d1 migrations` so that both
 * hosts run the same thing. The wrangler command exists only on Cloudflare, and
 * a node deployment would otherwise need a second, separately maintained way to
 * arrive at the same tables.
 *
 * Idempotent and cheap: one read when there is nothing to do.
 */
export async function migrate(sql: SqlStore): Promise<number> {
  await sql.run(
    `CREATE TABLE IF NOT EXISTS migrations (
       version    INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );

  const row = await sql.first<{ version: number | null }>(
    "SELECT MAX(version) AS version FROM migrations",
  );
  const applied = row?.version ?? -1;

  let count = 0;
  for (let version = applied + 1; version < MIGRATIONS.length; version++) {
    // One statement and its bookkeeping together: a migration that ran but was
    // not recorded would run again on the next boot, against tables that already
    // exist.
    await sql.batch([
      { sql: MIGRATIONS[version], params: [] },
      {
        sql: "INSERT INTO migrations (version, applied_at) VALUES (?, ?)",
        params: [version, new Date().toISOString()],
      },
    ]);
    count++;
  }
  return count;
}
