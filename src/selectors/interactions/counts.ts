import { replyCounts } from "./comments.ts";
import { counts as reactionCounts } from "./reactions.ts";
import type { Tally } from "../../models/activitypub/objects.ts";

/** Two grouped queries for every slug passed, not two per post; every slug gets a tally. */
export async function interactionCounts(slugs: string[]): Promise<Map<string, Tally>> {
  const [replyTally, reactionTally] = await Promise.all([replyCounts(slugs), reactionCounts(slugs)]);
  return new Map(slugs.map((slug) => [slug, {
    replies: replyTally.get(slug) ?? 0,
    ...(reactionTally.get(slug) ?? { likes: 0, shares: 0 }),
  }]));
}
