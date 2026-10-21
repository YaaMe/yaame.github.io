import { store } from "../../integrations/activitypub/store/database.ts";
import { countReactions } from "../../integrations/activitypub/store/reaction-rows.ts";

/** Counts keyed by content identifier, the same key replies are counted by. */
export async function counts(targets: string[]): Promise<Map<string, { likes: number; shares: number }>> {
  if (targets.length === 0) return new Map();
  return countReactions(await store(), targets);
}
