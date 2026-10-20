/**
 * Boosts and likes against a given database: the only file that queries the
 * reactions table.
 */
import { and, countDistinct, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../../../platform/types";
import { type Source, reactionId } from "../../../lib/interactions/key-scheme.ts";
import { storedReactionSchema, visitorIdentitySchema, type REACTION_KINDS } from "../../../lib/interactions/records.ts";
import { queryBatches } from "./query-batches.ts";
import { reactions, visitorIdentities } from "./schema.ts";

export type Kind = typeof REACTION_KINDS[number];

/** False when refused, or when the computed id is already held. */
export async function insertReaction(db: Database, value: unknown): Promise<boolean> {
  const reaction = storedReactionSchema.safeParse(value);
  if (!reaction.success) return false;
  const author = visitorIdentitySchema.safeParse({
    id: reaction.data.authorId,
    source: reaction.data.source,
    identifier: reaction.data.identifier,
    name: null,
  });
  if (!author.success) return false;
  await db.insert(visitorIdentities).values(author.data).onConflictDoNothing({ target: visitorIdentities.id });
  const written = await db.insert(reactions).values(reaction.data)
    .onConflictDoNothing({ target: reactions.id }).returning({ id: reactions.id });
  return written.length > 0;
}

/**
 * Withdraw exactly the reaction an Undo names.
 *
 * The id is computed from the signer and the named activity, as the inbox
 * computed it on receipt, so no one else's Undo can reach the row.
 */
export async function withdrawReaction(
  db: Database,
  undo: { source: Source; identifier: string; activityId: string },
): Promise<boolean> {
  let id: string;
  try {
    id = reactionId(undo);
  } catch {
    return false;
  }
  const changed = await db
    .update(reactions)
    .set({ undoneAt: new Date().toISOString() })
    .where(and(eq(reactions.id, id), isNull(reactions.undoneAt)))
    .returning({ id: reactions.id });
  return changed.length > 0;
}

/**
 * How many people liked or boosted each of these content identifiers.
 *
 * A person counts once per kind and target however many reactions they have
 * not withdrawn.
 *
 * One grouped query per hundred targets rather than one per post: callers pass
 * a whole timeline, and D1's free plan allows fifty queries per invocation.
 */
export async function countReactions(
  db: Database,
  targets: string[],
): Promise<Map<string, { likes: number; shares: number }>> {
  const tally = new Map<string, { likes: number; shares: number }>();
  // The undone filter binds nothing.
  for (const batch of queryBatches(targets, 0)) {
    const rows = await db
      .select({ target: reactions.target, kind: reactions.kind, n: countDistinct(reactions.authorId) })
      .from(reactions)
      .where(and(inArray(reactions.target, batch), isNull(reactions.undoneAt)))
      .groupBy(reactions.target, reactions.kind);
    for (const row of rows) {
      const entry = tally.get(row.target) ?? { likes: 0, shares: 0 };
      if (row.kind === "Like") entry.likes = Number(row.n);
      else entry.shares = Number(row.n);
      tally.set(row.target, entry);
    }
  }
  return tally;
}
