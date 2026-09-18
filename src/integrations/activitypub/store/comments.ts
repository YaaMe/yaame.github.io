/**
 * Replies, as they arrive and as they are read back.
 *
 * Every statement about comments is in this file, and every statement about the
 * schema is in schema.ts. That is the whole of the SQL — nothing else in the
 * tree writes a query, so the dialect stays in two files that can be read in one
 * sitting.
 */
import { platform } from "../../../platform";
import type { SqlStore } from "../../../platform/types";
import { migrate } from "./schema";

export type Comment = {
  activity_id: string;
  object_id: string;
  root_id: string;
  reply_to_id: string | null;
  actor_id: string;
  content: string;
  published: string;
  received_at: string;
  deleted_at: string | null;
  promoted_at: string | null;
};

/**
 * The store, with its schema known to be current.
 *
 * Migrations run once per isolate rather than at deploy time, because a deploy
 * has no database credentials of its own and both hosts would otherwise need a
 * separate way to reach the same tables. The cost when there is nothing to do is
 * one read.
 */
let ready: Promise<SqlStore> | null = null;

export function store(): Promise<SqlStore> {
  if (ready) return ready;
  ready = (async () => {
    const sql = platform.sql;
    if (sql === false) throw new Error("no database is bound");
    await migrate(sql);
    return sql;
  })();
  // A failed migration must not be remembered as done: leaving the rejected
  // promise cached would make every later request fail with the first error,
  // long after whatever caused it had passed.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

/**
 * Where a reply belongs.
 *
 * Threads are stored flat with the root repeated on every row, so reading one is
 * a single indexed range. That needs the root at insert time: the parent is
 * either something of ours — in which case it is the root — or another comment
 * we already hold, whose root we adopt. A parent we have never seen means the
 * conversation did not start here, and we keep nothing.
 */
async function rootOf(
  sql: SqlStore,
  parent: string,
  ours: (id: string) => boolean,
): Promise<string | null> {
  if (ours(parent)) return parent;
  const row = await sql.first<{ root_id: string }>(
    "SELECT root_id FROM comments WHERE object_id = ?",
    parent,
  );
  return row?.root_id ?? null;
}

/**
 * Record a reply.
 *
 * Returns false when it was not stored — a reply to something that is not ours,
 * or one already held. Both are ordinary: ActivityPub §5.2 requires
 * de-duplication by activity id, and a redelivery is how that requirement gets
 * exercised. The constraint in the schema is what enforces it; this only has to
 * not treat the rejection as an error.
 */
export async function record(
  comment: Omit<Comment, "root_id" | "received_at" | "deleted_at" | "promoted_at"> & {
    reply_to_id: string;
  },
  ours: (id: string) => boolean,
): Promise<boolean> {
  const sql = await store();
  const root = await rootOf(sql, comment.reply_to_id, ours);
  if (root === null) return false;

  const changes = await sql.run(
    `INSERT OR IGNORE INTO comments
       (activity_id, object_id, root_id, reply_to_id, actor_id, content, published, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    comment.activity_id,
    comment.object_id,
    root,
    // The root is not its own parent: a reply directly to our post has no
    // comment above it, and storing the root here would make the tree claim a
    // parent that is not in the table.
    comment.reply_to_id === root ? null : comment.reply_to_id,
    comment.actor_id,
    comment.content,
    comment.published,
    new Date().toISOString(),
  );
  return changes > 0;
}

/**
 * Mark a comment deleted.
 *
 * The row stays. We still owe a record of what was here — and if the comment was
 * promoted into git, the removal there is raised against this row.
 */
export async function remove(objectId: string, actorId: string): Promise<boolean> {
  const sql = await store();
  // Scoped to the actor: a Delete only speaks for its own sender's objects, and
  // without this clause anyone could erase anyone's comment by naming its id.
  const changes = await sql.run(
    "UPDATE comments SET deleted_at = ?, content = '' WHERE object_id = ? AND actor_id = ? AND deleted_at IS NULL",
    new Date().toISOString(),
    objectId,
    actorId,
  );
  return changes > 0;
}

/** Everything under one of our posts, oldest first, deleted ones included. */
export async function thread(rootId: string): Promise<Comment[]> {
  const sql = await store();
  return sql.all<Comment>(
    "SELECT * FROM comments WHERE root_id = ? ORDER BY published ASC",
    rootId,
  );
}
