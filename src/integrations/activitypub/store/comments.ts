/**
 * Replies, as they arrive and as they are read back.
 *
 * Reads use Drizzle so host-specific database access stays in the platform.
 */
import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { commentHref } from "../../../lib/interactions/comment-schema";
import { SOURCES, commentId, identityId } from "../../../lib/interactions/key-scheme";
import type { Database } from "../../../platform/types";
import { store } from "./database";
import { comments } from "./schema";
import { insertComment } from "./write-comment";

export type Comment = typeof comments.$inferSelect;

// D1 permits at most 100 bound parameters per query.
// https://developers.cloudflare.com/d1/platform/limits/
const D1_MAX_BOUND_PARAMETERS = 100;

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
  ours: (id: string) => string | null,
): Promise<{ root: string; replyTo: string | null } | null> {
  const root = ours(parent);
  if (root !== null) return { root, replyTo: null };
  const [row] = await db
    .select({ root: comments.root, replyTo: comments.id })
    .from(comments)
    .where(and(eq(comments.objectId, parent), eq(comments.source, SOURCES.activitypub)))
    .orderBy(asc(comments.receivedAt), asc(comments.id))
    .limit(1);
  return row ?? null;
}

/**
 * Record a reply.
 *
 * False when it was not stored — a reply to something that is not ours, or one
 * already held. The primary key identifies the Note and its signing actor,
 * so redelivery in a new Create also leaves the stored comment unchanged.
 */
export async function record(
  reply: {
    activityId: string;
    objectId: string;
    inReplyTo: string;
    actorId: string;
    content: string;
    published: string;
  },
  ours: (id: string) => string | null,
): Promise<boolean> {
  const db = await store();
  const thread = await rootOf(db, reply.inReplyTo, ours);
  if (thread === null) return false;
  const inputs = { source: SOURCES.activitypub, identifier: reply.actorId, objectId: reply.objectId };
  let id: string;
  let authorId: string;
  try {
    id = commentId(inputs);
    authorId = identityId(inputs.source, inputs.identifier);
  } catch {
    return false;
  }
  return insertComment(db, {
    ...inputs,
    id,
    authorId,
    activityId: reply.activityId,
    inReplyTo: reply.inReplyTo,
    submissionId: null,
    ...thread,
    content: reply.content,
    published: reply.published,
    receivedAt: new Date().toISOString(),
    deletedAt: null,
    promotedAt: null,
  });
}

/**
 * Mark a comment deleted.
 *
 * The row stays. We still owe a record of what was here — and if the comment was
 * carried into git, the removal there is raised against this row.
 */
export async function remove(objectId: string, actorId: string): Promise<boolean> {
  if (!commentHref.safeParse(objectId).success || !commentHref.safeParse(actorId).success) return false;
  const db = await store();
  const changed = await db
    .update(comments)
    .set({ deletedAt: new Date().toISOString(), content: "" })
    .where(eq(comments.id, commentId({ source: SOURCES.activitypub, identifier: actorId, objectId })))
    .returning({ id: comments.id });
  return changed.length > 0;
}

/** Everything under one of our posts, oldest first, deleted ones included. */
export async function thread(root: string): Promise<Comment[]> {
  const db = await store();
  return db.select().from(comments).where(eq(comments.root, root)).orderBy(asc(comments.published));
}

/** Deletions for one thread, without returning the withdrawn text to a page. */
export async function withdrawn(root: string): Promise<Map<string, string>> {
  return (await withdrawnMany([root])).get(root) ?? new Map();
}

/** Deletions for several threads, grouped by root without returning text. */
export async function withdrawnMany(
  roots: string[],
): Promise<Map<string, Map<string, string>>> {
  if (roots.length === 0) return new Map();
  const db = await store();
  const result = new Map<string, Map<string, string>>();
  for (let offset = 0; offset < roots.length; offset += D1_MAX_BOUND_PARAMETERS) {
    const rows = await db
      .select({
        root: comments.root,
        id: comments.id,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .where(
        and(
          inArray(comments.root, roots.slice(offset, offset + D1_MAX_BOUND_PARAMETERS)),
          isNotNull(comments.deletedAt),
        ),
      );
    for (const row of rows) {
      if (row.deletedAt === null) continue;
      const byId = result.get(row.root) ?? new Map<string, string>();
      byId.set(row.id, row.deletedAt);
      result.set(row.root, byId);
    }
  }
  return result;
}

/**
 * How many replies each of these posts has.
 *
 * One grouped query for every id passed, rather than one per post: callers
 * can pass a whole timeline, and D1's free plan allows fifty queries per
 * invocation.
 *
 * Deleted replies are excluded. The row survives as a record, but a count is a
 * claim about what a reader can find, and they cannot find that one.
 */
export async function replyCounts(roots: string[]): Promise<Map<string, number>> {
  if (roots.length === 0) return new Map();
  const db = await store();
  const countsByRoot = new Map<string, number>();
  for (let offset = 0; offset < roots.length; offset += D1_MAX_BOUND_PARAMETERS - 1) {
    const rows = await db
      .select({ root: comments.root, n: count() })
      .from(comments)
      .where(
        and(
          inArray(comments.root, roots.slice(offset, offset + D1_MAX_BOUND_PARAMETERS - 1)),
          eq(comments.source, SOURCES.activitypub),
          isNull(comments.deletedAt),
        ),
      )
      .groupBy(comments.root);
    for (const row of rows) countsByRoot.set(row.root, Number(row.n));
  }
  return countsByRoot;
}

/** The replies under a post, oldest first, deleted ones left out. */
export async function replies(root: string): Promise<Array<Comment & { objectId: string }>> {
  const db = await store();
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.root, root), eq(comments.source, SOURCES.activitypub), isNull(comments.deletedAt)))
    .orderBy(asc(comments.published));
  return rows.filter((row): row is Comment & { objectId: string } => row.objectId !== null);
}
