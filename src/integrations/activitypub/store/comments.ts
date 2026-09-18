/**
 * Replies, as they arrive and as they are read back.
 *
 * The only file that queries the comments table. Everything is expressed through
 * Drizzle against the definitions in schema.ts, so a deployment that brings its
 * own database changes the driver and not this.
 */
import { and, asc, eq } from "drizzle-orm";
import { platform } from "../../../platform";
import type { Database } from "../../../platform/types";
import { comments, migrate } from "./schema";

export type Comment = typeof comments.$inferSelect;

/**
 * The database, with its schema known to be current.
 *
 * Migrations run once per isolate rather than at deploy time, because a deploy
 * holds no database credentials of its own and both hosts would otherwise need
 * separate ways to reach the same tables. When there is nothing to do it costs
 * one read.
 */
let ready: Promise<Database> | null = null;

export function store(): Promise<Database> {
  if (ready) return ready;
  ready = (async () => {
    const db = platform.db;
    if (db === false) throw new Error("no database is bound");
    await migrate(db);
    return db;
  })();
  // A failed migration must not be remembered as done: a cached rejection would
  // make every later request fail with the first error, long after whatever
  // caused it had passed.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

/**
 * Where a reply belongs.
 *
 * Threads are stored flat with the root repeated on every row, so reading one
 * is a single indexed range. That needs the root at insert time: the parent is
 * either something of ours — in which case it is the root — or another comment
 * we already hold, whose root we adopt. A parent we have never seen means the
 * conversation did not start here, and we keep nothing.
 */
async function rootOf(
  db: Database,
  parent: string,
  ours: (id: string) => boolean,
): Promise<string | null> {
  if (ours(parent)) return parent;
  const [row] = await db
    .select({ rootId: comments.rootId })
    .from(comments)
    .where(eq(comments.objectId, parent))
    .limit(1);
  return row?.rootId ?? null;
}

/**
 * Record a reply.
 *
 * False when it was not stored — a reply to something that is not ours, or one
 * already held. Both are ordinary: §5.2 requires de-duplication by activity id,
 * and a redelivery is how that requirement gets exercised. The primary key
 * enforces it; this only has to not treat the refusal as an error.
 */
export async function record(
  reply: {
    activityId: string;
    objectId: string;
    replyToId: string;
    actorId: string;
    content: string;
    published: string;
  },
  ours: (id: string) => boolean,
): Promise<boolean> {
  const db = await store();
  const root = await rootOf(db, reply.replyToId, ours);
  if (root === null) return false;

  // RETURNING rather than a changed-row count. The two drivers disagree about
  // that count — D1 reports `rowsAffected`, node:sqlite `changes` — so reading
  // it would have made every insert on node look like a duplicate while it
  // quietly succeeded. What comes back here is rows, which both spell the same.
  const written = await db
    .insert(comments)
    .values({
      ...reply,
      rootId: root,
      // The root is not its own parent: a reply directly to our post has no
      // comment above it, and storing the root here would make the tree claim a
      // parent that is not in the table.
      replyToId: reply.replyToId === root ? null : reply.replyToId,
      receivedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: comments.activityId });

  return written.length > 0;
}

/**
 * Mark a comment deleted.
 *
 * The row stays. We still owe a record of what was here — and if the comment was
 * carried into git, the removal there is raised against this row.
 */
export async function remove(objectId: string, actorId: string): Promise<boolean> {
  const db = await store();
  const changed = await db
    .update(comments)
    .set({ deletedAt: new Date().toISOString(), content: "" })
    // Scoped to the actor: a Delete speaks only for its sender's own objects,
    // and without this anyone could erase anyone's comment by naming its id.
    .where(and(eq(comments.objectId, objectId), eq(comments.actorId, actorId)))
    .returning({ id: comments.activityId });
  return changed.length > 0;
}

/** Everything under one of our posts, oldest first, deleted ones included. */
export async function thread(rootId: string): Promise<Comment[]> {
  const db = await store();
  return db.select().from(comments).where(eq(comments.rootId, rootId)).orderBy(asc(comments.published));
}
