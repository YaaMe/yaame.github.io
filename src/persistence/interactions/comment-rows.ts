/**
 * Replies, as they arrive and as they are read back.
 *
 * Reads use Drizzle so host-specific database access stays in the platform.
 */
import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { SOURCES } from "../../models/interactions/key-scheme.ts";
import type { Database } from "../../platform/types.ts";
import { queryBatches } from "./query-batches.ts";
import { comments } from "../../models/interactions/tables.ts";

export type Comment = typeof comments.$inferSelect;

export async function findCommentParent(db: Database, parent: string): Promise<{ root: string; replyTo: string } | null> {
  const [row] = await db
    .select({ root: comments.root, replyTo: comments.id })
    .from(comments)
    .where(and(eq(comments.objectId, parent), eq(comments.source, SOURCES.activitypub)))
    .orderBy(asc(comments.receivedAt), asc(comments.id))
    .limit(1);
  return row ?? null;
}

export async function listThread(db: Database, root: string): Promise<Comment[]> {
  return db.select().from(comments).where(eq(comments.root, root)).orderBy(asc(comments.published));
}

export async function listWithdrawals(db: Database, roots: string[]) {
  const result: Array<Pick<Comment, "root" | "id" | "deletedAt">> = [];
  // The deleted filter binds nothing.
  for (const batch of queryBatches(roots, 0)) {
    const rows = await db
      .select({
        root: comments.root,
        id: comments.id,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .where(
        and(
          inArray(comments.root, batch),
          isNotNull(comments.deletedAt),
        ),
      );
    for (const row of rows) result.push(row);
  }
  return result;
}

export async function countReplies(db: Database, roots: string[]) {
  const result: Array<{ root: string; n: number }> = [];
  // The source is bound beside the roots.
  for (const batch of queryBatches(roots, 1)) {
    const rows = await db
      .select({ root: comments.root, n: count() })
      .from(comments)
      .where(
        and(
          inArray(comments.root, batch),
          eq(comments.source, SOURCES.activitypub),
          isNull(comments.deletedAt),
        ),
      )
      .groupBy(comments.root);
    for (const row of rows) result.push(row);
  }
  return result;
}

export async function listReplies(db: Database, root: string): Promise<Comment[]> {
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.root, root), eq(comments.source, SOURCES.activitypub), isNull(comments.deletedAt)))
    .orderBy(asc(comments.published));
}
