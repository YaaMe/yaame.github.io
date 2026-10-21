import type { Database } from "../../platform/types.ts";
import { store } from "../../integrations/activitypub/store/database.ts";
import { findCommentParent, listThread, listWithdrawals, countReplies, listReplies, type Comment } from "../../integrations/activitypub/store/comment-rows.ts";

export type { Comment };

/**
 * Where a reply belongs.
 *
 * Threads are stored flat with the root repeated on every row, so reading one
 * is a single indexed range. That needs the root at insert time: the parent is
 * either something of ours — in which case it is the root — or another comment
 * we already hold, whose root we adopt. A parent we have never seen means the
 * conversation did not start here, and we keep nothing.
 */
export async function rootOf(
  db: Database,
  parent: string,
  ours: (id: string) => string | null,
): Promise<{ root: string; replyTo: string | null } | null> {
  const root = ours(parent);
  if (root !== null) return { root, replyTo: null };
  return findCommentParent(db, parent);
}

/** Everything under one of our posts, oldest first, deleted ones included. */
export async function thread(root: string): Promise<Comment[]> {
  return listThread(await store(), root);
}

/** Deletions for one thread, without returning the withdrawn text to a page. */
export async function withdrawn(root: string): Promise<Map<string, string>> {
  return (await withdrawnMany([root])).get(root) ?? new Map();
}

/** Deletions for several threads, grouped by root without returning text. */
export async function withdrawnMany(roots: string[]): Promise<Map<string, Map<string, string>>> {
  if (roots.length === 0) return new Map();
  const rows = await listWithdrawals(await store(), roots);
  const result = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (row.deletedAt === null) continue;
    const byId = result.get(row.root) ?? new Map<string, string>();
    byId.set(row.id, row.deletedAt);
    result.set(row.root, byId);
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
  const rows = await countReplies(await store(), roots);
  return new Map(rows.map((row) => [row.root, Number(row.n)]));
}

/** The replies under a post, oldest first, deleted ones left out. */
export async function replies(root: string): Promise<Array<Comment & { objectId: string }>> {
  const rows = await listReplies(await store(), root);
  return rows.filter((row): row is Comment & { objectId: string } => row.objectId !== null);
}
