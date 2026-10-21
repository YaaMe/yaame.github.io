import { SOURCES, identityId, normalizedUrl } from "../../models/interactions/key-scheme.ts";
import { store } from "../../persistence/interactions/database.ts";
import { removeFollower, removeFollowersAtInbox, upsertFollower } from "../../persistence/interactions/follower-rows.ts";

/** False when the actor or an address is not one the table accepts. */
export async function follow(
  follower: { actorUrl: string; inbox: string; sharedInbox: string | null; followId: string | null },
): Promise<boolean> {
  let identifier: string;
  let id: string;
  try {
    identifier = normalizedUrl(follower.actorUrl);
    id = identityId(SOURCES.activitypub, identifier);
  } catch {
    return false;
  }
  return upsertFollower(await store(), {
    id,
    source: SOURCES.activitypub,
    identifier,
    inbox: follower.inbox,
    sharedInbox: follower.sharedInbox,
    followId: follower.followId,
    followedAt: new Date().toISOString(),
  });
}

export async function unfollow(signer: string): Promise<boolean> {
  return removeFollower(await store(), SOURCES.activitypub, signer);
}

export async function dropAtInbox(actorIds: readonly string[], inbox: string): Promise<string[]> {
  return removeFollowersAtInbox(await store(), SOURCES.activitypub, actorIds, inbox);
}
