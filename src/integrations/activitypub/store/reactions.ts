/**
 * Boosts and likes, as they arrive and as they are counted.
 *
 * The only file that queries the reactions table.
 */
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { reactions } from "./schema";
import { store } from "./comments";

export type Kind = "Announce" | "Like";

/**
 * Record a boost or a like.
 *
 * False when it was already held. §5.2 requires de-duplication by activity id
 * and the primary key enforces it; a redelivery is ordinary, not an error.
 */
export async function record(
  reaction: { activityId: string; objectId: string; actorId: string; kind: Kind },
  ours: (id: string) => boolean,
): Promise<boolean> {
  // Only about our own objects. A boost of someone else's post can reach our
  // inbox because a follower's server addresses it to us, and counting those
  // would make the numbers on our posts include things that are not ours.
  if (!ours(reaction.objectId)) return false;

  const db = await store();
  const written = await db
    .insert(reactions)
    .values({ ...reaction, receivedAt: new Date().toISOString() })
    .onConflictDoNothing()
    .returning({ id: reactions.activityId });
  return written.length > 0;
}

/**
 * Withdraw one.
 *
 * Matched on who and what rather than on the original activity's id: an Undo
 * names the activity it undoes, but senders spell that id inconsistently, while
 * "this actor's boost of this object" identifies it either way.
 */
export async function undo(
  objectId: string,
  actorId: string,
  kind: Kind,
): Promise<boolean> {
  const db = await store();
  const changed = await db
    .update(reactions)
    .set({ undoneAt: new Date().toISOString() })
    .where(
      and(
        eq(reactions.objectId, objectId),
        eq(reactions.actorId, actorId),
        eq(reactions.kind, kind),
        isNull(reactions.undoneAt),
      ),
    )
    .returning({ id: reactions.activityId });
  return changed.length > 0;
}

/**
 * How many of each kind these objects carry.
 *
 * One grouped query for a whole page: a page holds up to twenty posts, and
 * D1's free plan allows fifty queries per invocation.
 */
export async function counts(
  objectIds: string[],
): Promise<Map<string, { likes: number; shares: number }>> {
  const empty = new Map<string, { likes: number; shares: number }>();
  if (objectIds.length === 0) return empty;

  const db = await store();
  const rows = await db
    .select({ objectId: reactions.objectId, kind: reactions.kind, n: count() })
    .from(reactions)
    .where(and(inArray(reactions.objectId, objectIds), isNull(reactions.undoneAt)))
    .groupBy(reactions.objectId, reactions.kind);

  for (const row of rows) {
    const entry = empty.get(row.objectId) ?? { likes: 0, shares: 0 };
    if (row.kind === "Like") entry.likes = Number(row.n);
    else entry.shares = Number(row.n);
    empty.set(row.objectId, entry);
  }
  return empty;
}
