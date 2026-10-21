import { SOURCES, identityId, reactionId } from "../../models/interactions/key-scheme.ts";
import { store } from "../../persistence/interactions/database.ts";
import { insertReaction, withdrawReaction, type Kind } from "../../persistence/interactions/reaction-rows.ts";

export type { Kind };

/**
 * Record a boost or a like.
 *
 * False when it was not stored. §5.2 requires de-duplication by activity id;
 * the primary key is computed from the signer and the activity, so a
 * redelivery is ordinary, not an error.
 */
export async function record(
  reaction: { activityId: string; objectId: string; actorId: string; kind: Kind },
  contentOf: (id: string) => string | null,
): Promise<boolean> {
  // Only about our own content. A boost of someone else's post can reach our
  // inbox because a follower's server addresses it to us, and counting those
  // would make the numbers on our posts include things that are not ours.
  const target = contentOf(reaction.objectId);
  if (target === null) return false;

  const inputs = { source: SOURCES.activitypub, identifier: reaction.actorId, activityId: reaction.activityId };
  let id: string;
  let authorId: string;
  try {
    id = reactionId(inputs);
    authorId = identityId(inputs.source, inputs.identifier);
  } catch {
    return false;
  }
  return insertReaction(await store(), {
    ...inputs,
    id,
    authorId,
    objectId: reaction.objectId,
    target,
    kind: reaction.kind,
    receivedAt: new Date().toISOString(),
    undoneAt: null,
  });
}

/** Withdraw the reaction the signer's Undo names; anyone else's Undo changes nothing. */
export async function undo(signer: string, activityId: string): Promise<boolean> {
  return withdrawReaction(await store(), { source: SOURCES.activitypub, identifier: signer, activityId });
}
