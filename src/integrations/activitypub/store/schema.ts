/**
 * The tables, declared once for both hosts.
 *
 * Drizzle renders these into SQLite for D1 and for node:sqlite. Scripts also
 * send raw SQL to these tables, so a column change must reach them too.
 *
 * Times are ISO 8601 strings. SQLite has no date type, every dialect reads an
 * ISO string the same way, and a numeric epoch would have to be decoded by hand
 * wherever it is read.
 */
import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Database } from "../../../platform/types";
import {
  comments as commentsLocation,
  migrations as migrationsLocation,
  reactions as reactionsLocation,
  visitorIdentities as identitiesLocation,
} from "../../../data.config.generated.mjs";

const commentsColumns = commentsLocation.columns;
const reactionsColumns = reactionsLocation.columns;
const migrationsColumns = migrationsLocation;
const identityColumns = identitiesLocation.columns;

export const visitorIdentities = sqliteTable(identitiesLocation.sql, {
  id: text(identityColumns.id).primaryKey(),
  source: text(identityColumns.source).notNull(),
  identifier: text(identityColumns.identifier).notNull(),
  name: text(identityColumns.name),
});

export const comments = sqliteTable(
  commentsLocation.sql,
  {
    id: text(commentsColumns.id).primaryKey(),
    source: text(commentsColumns.source).notNull(),
    identifier: text(commentsColumns.identifier).notNull(),
    // The application maintains authorId and replyTo references; the database intentionally does not enforce them.
    authorId: text(commentsColumns.authorId).notNull(),
    activityId: text(commentsColumns.activityId),
    objectId: text(commentsColumns.objectId),
    submissionId: text(commentsColumns.submissionId),
    inReplyTo: text(commentsColumns.inReplyTo),
    root: text(commentsColumns.root).notNull(),
    replyTo: text(commentsColumns.replyTo),
    content: text(commentsColumns.content).notNull(),
    published: text(commentsColumns.published).notNull(),
    receivedAt: text(commentsColumns.receivedAt).notNull(),

    /**
     * Set when a Delete arrives. The row stays: we still owe a record that
     * something was here, and a promoted comment needs one to raise a removal
     * against.
     */
    deletedAt: text(commentsColumns.deletedAt),

    /** Set when carried into git — the point it stops being ours to erase. */
    promotedAt: text(commentsColumns.promotedAt),
  },
  (t) => [
    index("comments_by_thread").on(t.root, t.published),
    index("comments_by_actor").on(t.authorId, t.published),
    index("comments_by_object").on(t.objectId),
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
  reactionsLocation.sql,
  {
    /** The activity id — de-duplication, §5.2, enforced by the database. */
    activityId: text(reactionsColumns.activityId).primaryKey(),

    /** Which of our objects this is about. */
    objectId: text(reactionsColumns.objectId).notNull(),

    actorId: text(reactionsColumns.actorId).notNull(),

    /** `Announce` or `Like`. */
    kind: text(reactionsColumns.kind).notNull(),

    receivedAt: text(reactionsColumns.receivedAt).notNull(),

    /**
     * Set when an Undo arrives. The row stays rather than being deleted, so a
     * repeat of the original activity is still refused by the primary key —
     * deleting it would let the same boost be counted again.
     */
    undoneAt: text(reactionsColumns.undoneAt),
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
 * Hand-written rather than generated: drizzle-kit is not installed here, and
 * these are meant to be replaced by its output when it is.
 */
const MIGRATIONS: (string | string[])[] = [
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
  [
    `CREATE TABLE comments_drop_guard (approved INTEGER CONSTRAINT comments_drop_requires_approved_snapshot CHECK (approved = 1))`,
    `INSERT INTO comments_drop_guard
       SELECT CASE WHEN COUNT(*) = 0 OR (
         COUNT(*) = 1 AND COUNT(CASE WHEN
           activity_id = 'https://activitypub.academy/users/banules_kuraks/statuses/117290977176624180/activity'
           AND object_id = 'https://activitypub.academy/users/banules_kuraks/statuses/117290977176624180'
           AND actor_id = 'https://activitypub.academy/users/banules_kuraks'
           AND published = '2026-09-18T07:57:59Z'
           AND deleted_at = '2026-09-18T09:25:26.283Z'
         THEN 1 END) = 1
       ) THEN 1 ELSE 0 END FROM comments`,
    `DROP TABLE comments`,
    `CREATE TABLE visitor_identities (
       id TEXT PRIMARY KEY NOT NULL,
       source TEXT NOT NULL,
       identifier TEXT NOT NULL,
       name TEXT
     )`,
    `CREATE TABLE comments (
       id TEXT PRIMARY KEY NOT NULL,
       source TEXT NOT NULL,
       identifier TEXT NOT NULL,
       author_id TEXT NOT NULL,
       activity_id TEXT,
       object_id TEXT,
       submission_id TEXT,
       in_reply_to TEXT,
       root TEXT NOT NULL,
       reply_to TEXT,
       content TEXT NOT NULL,
       published TEXT NOT NULL,
       received_at TEXT NOT NULL,
       deleted_at TEXT,
       promoted_at TEXT
     )`,
    `CREATE INDEX comments_by_thread ON comments (root, published)`,
    `CREATE INDEX comments_by_actor ON comments (author_id, published)`,
    `CREATE INDEX comments_by_object ON comments (object_id)`,
    `DROP TABLE comments_drop_guard`,
  ],
];

/**
 * Requires an empty application schema: every migration must accept empty tables.
 * Record all versions so migrate() cannot replay non-idempotent migrations.
 * Recovery may preload exported version rows to preserve their timestamps.
 */
export function schemaBootstrapStatements(): string[] {
  const appliedAt = new Date().toISOString();
  return [
    `CREATE TABLE IF NOT EXISTS ${migrationsLocation.table} (${migrationsColumns.quotedColumns.version} INTEGER PRIMARY KEY, ${migrationsColumns.quotedColumns.appliedAt} TEXT NOT NULL)`,
    ...MIGRATIONS.flat(),
    ...MIGRATIONS.map((_migration, version) =>
      `INSERT OR IGNORE INTO ${migrationsLocation.table} (${migrationsColumns.quotedColumns.version}, ${migrationsColumns.quotedColumns.appliedAt}) VALUES (${version}, '${appliedAt}')`,
    ),
  ];
}

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
  await db.run(sql.raw(schemaBootstrapStatements()[0]));

  const rows = await db.all<{ version: number | null }>(
    sql.raw(
      `SELECT MAX(${migrationsColumns.quotedColumns.version}) AS version FROM ${migrationsLocation.table}`,
    ),
  );
  const applied = rows[0]?.version ?? -1;

  let count = 0;
  for (let version = applied + 1; version < MIGRATIONS.length; version++) {
    try {
      await db.atomic([
        `INSERT INTO ${migrationsLocation.table} (${migrationsColumns.quotedColumns.version}, ${migrationsColumns.quotedColumns.appliedAt}) VALUES (${version}, '${new Date().toISOString()}')`,
        ...[MIGRATIONS[version]].flat(),
      ]);
      count++;
    } catch (error) {
      const completed = await db.all(sql`SELECT 1 FROM ${sql.raw(migrationsLocation.table)} WHERE ${sql.raw(migrationsColumns.quotedColumns.version)} = ${version}`);
      if (completed.length === 0) throw error;
    }
  }
  return count;
}
