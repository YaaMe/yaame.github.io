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
export const MIGRATIONS: readonly (string | readonly string[])[] = [
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
  [
    `CREATE TABLE reactions_drop_guard (approved INTEGER CONSTRAINT reactions_drop_requires_approved_snapshot CHECK (approved = 1))`,
    `INSERT INTO reactions_drop_guard
       SELECT CASE WHEN COUNT(*) = 0 OR (
         COUNT(*) = 2 AND COUNT(CASE WHEN
           activity_id = 'https://activitypub.academy/users/banules_kuraks/statuses/117291094176571436/activity'
           AND actor_id = 'https://activitypub.academy/users/banules_kuraks'
           AND object_id = 'https://yaame.dev/users/yaame/notes/2025-year'
           AND kind = 'Announce'
           AND received_at = '2026-09-18T08:27:52.904Z'
           AND undone_at = '2026-09-18T08:27:53.251Z'
         THEN 1 END) = 1 AND COUNT(CASE WHEN
           activity_id = 'https://activitypub.academy/users/banules_kuraks#likes/1690'
           AND actor_id = 'https://activitypub.academy/users/banules_kuraks'
           AND object_id = 'https://yaame.dev/users/yaame/notes/2025-year'
           AND kind = 'Like'
           AND received_at = '2026-09-18T08:27:53.059Z'
           AND undone_at = '2026-09-18T08:27:59.604Z'
         THEN 1 END) = 1
       ) THEN 1 ELSE 0 END FROM reactions`,
    `DROP TABLE reactions`,
    `CREATE TABLE reactions (
       id TEXT PRIMARY KEY NOT NULL,
       source TEXT NOT NULL,
       identifier TEXT NOT NULL,
       author_id TEXT NOT NULL,
       activity_id TEXT NOT NULL,
       object_id TEXT NOT NULL,
       target TEXT NOT NULL,
       kind TEXT NOT NULL,
       received_at TEXT NOT NULL,
       undone_at TEXT
     )`,
    `CREATE INDEX reactions_by_target ON reactions (target, kind, author_id)`,
    `DROP TABLE reactions_drop_guard`,
  ],
  [
    `CREATE TABLE followers (
       id TEXT PRIMARY KEY NOT NULL,
       source TEXT NOT NULL,
       identifier TEXT NOT NULL,
       inbox TEXT,
       shared_inbox TEXT,
       follow_id TEXT,
       followed_at TEXT NOT NULL
     )`,
    `CREATE INDEX followers_by_source ON followers (source, followed_at, id)`,
    `CREATE INDEX followers_by_inbox ON followers (source, inbox)`,
  ],
  [
    `CREATE TABLE deliveries (
       id TEXT PRIMARY KEY NOT NULL,
       channel TEXT NOT NULL,
       target TEXT NOT NULL,
       enqueued_at TEXT NOT NULL
     )`,
    `CREATE INDEX deliveries_by_channel ON deliveries (channel, target)`,
  ],
];
