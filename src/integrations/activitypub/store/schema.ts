/**
 * The tables, declared once for both hosts.
 *
 * Drizzle renders these into SQLite for D1 and for node:sqlite; the same
 * definitions carry to its postgres driver if a deployment ever brings its own
 * database. Nothing above this file writes SQL.
 *
 * Times are ISO 8601 strings. SQLite has no date type, every dialect reads an
 * ISO string the same way, and a numeric epoch would have to be decoded by hand
 * wherever it is read.
 */
import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Database } from "../../../platform/types";

export const comments = sqliteTable(
  "comments",
  {
    /**
     * The activity's id, not the object's.
     *
     * ActivityPub §5.2 requires de-duplication by activity id, so this is the
     * primary key: a redelivery is refused by the database rather than by
     * whoever remembered to check.
     */
    activityId: text("activity_id").primaryKey(),

    /** The Note itself — what a Delete names, and what a reply points at. */
    objectId: text("object_id").notNull().unique(),

    /**
     * The top of the thread, usually one of our own posts.
     *
     * Stored rather than walked, so "everything under this post" is one indexed
     * range instead of a recursive climb on every render.
     */
    rootId: text("root_id").notNull(),

    /** The direct parent, null when the reply is to the root itself. */
    replyToId: text("reply_to_id"),

    actorId: text("actor_id").notNull(),
    content: text("content").notNull(),
    published: text("published").notNull(),
    receivedAt: text("received_at").notNull(),

    /**
     * Set when a Delete arrives. The row stays: we still owe a record that
     * something was here, and a promoted comment needs one to raise a removal
     * against.
     */
    deletedAt: text("deleted_at"),

    /** Set when carried into git — the point it stops being ours to erase. */
    promotedAt: text("promoted_at"),
  },
  (t) => [
    index("comments_by_thread").on(t.rootId, t.published),
    index("comments_by_actor").on(t.actorId, t.published),
  ],
);

/**
 * Boosts and likes.
 *
 * One table for both, because they differ only in the verb: same sender, same
 * target, same undo. Splitting them would duplicate the whole shape to record
 * a word that fits in a column.
 */
export const reactions = sqliteTable(
  "reactions",
  {
    /** The activity id — de-duplication, §5.2, enforced by the database. */
    activityId: text("activity_id").primaryKey(),

    /** Which of our objects this is about. */
    objectId: text("object_id").notNull(),

    actorId: text("actor_id").notNull(),

    /** `Announce` or `Like`. */
    kind: text("kind").notNull(),

    receivedAt: text("received_at").notNull(),

    /**
     * Set when an Undo arrives. The row stays rather than being deleted, so a
     * repeat of the original activity is still refused by the primary key —
     * deleting it would let the same boost be counted again.
     */
    undoneAt: text("undone_at"),
  },
  (t) => [index("reactions_by_object").on(t.objectId, t.kind)],
);

/**
 * Applied in order, never edited once shipped.
 *
 * Editing a migration that has already run somewhere leaves two databases
 * claiming the same version with different shapes, and nothing reports it. To
 * change the schema, append.
 *
 * Hand-written for now. drizzle-kit generates these from a schema diff, and will
 * take over here once it can be installed — the npm cache on this machine is not
 * writable, which is a local problem rather than a decision.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS comments (
     activity_id TEXT PRIMARY KEY,
     object_id   TEXT NOT NULL UNIQUE,
     root_id     TEXT NOT NULL,
     reply_to_id TEXT,
     actor_id    TEXT NOT NULL,
     content     TEXT NOT NULL,
     published   TEXT NOT NULL,
     received_at TEXT NOT NULL,
     deleted_at  TEXT,
     promoted_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS comments_by_thread ON comments (root_id, published)`,
  `CREATE INDEX IF NOT EXISTS comments_by_actor ON comments (actor_id, published)`,
  `CREATE TABLE IF NOT EXISTS reactions (
     activity_id TEXT PRIMARY KEY,
     object_id   TEXT NOT NULL,
     actor_id    TEXT NOT NULL,
     kind        TEXT NOT NULL,
     received_at TEXT NOT NULL,
     undone_at   TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS reactions_by_object ON reactions (object_id, kind)`,
];

/**
 * Bring a database up to the current schema.
 *
 * Run here rather than delegated to `wrangler d1 migrations` so both hosts do
 * the same thing: that command exists only on Cloudflare, and a node deployment
 * would otherwise need a second, separately maintained way to the same tables.
 *
 * Idempotent, and one read when there is nothing to do.
 */
export async function migrate(db: Database): Promise<number> {
  await db.run(
    sql`CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );

  const rows = await db.all<{ version: number | null }>(
    sql`SELECT MAX(version) AS version FROM migrations`,
  );
  const applied = rows[0]?.version ?? -1;

  let count = 0;
  for (let version = applied + 1; version < MIGRATIONS.length; version++) {
    // Sequential rather than batched: batching is driver-specific — D1 has
    // `batch`, node:sqlite a transaction — and depending on either would make
    // this file know which host it is on. Instead every statement is written to
    // be safe to repeat, so a crash between the migration and its bookkeeping
    // costs a re-run and nothing else.
    await db.run(sql.raw(MIGRATIONS[version]));
    await db.run(
      sql`INSERT INTO migrations (version, applied_at) VALUES (${version}, ${new Date().toISOString()})`,
    );
    count++;
  }
  return count;
}
