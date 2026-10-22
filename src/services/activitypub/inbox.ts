import type { Context } from "@fedify/fedify";
import type { Actor } from "@fedify/fedify/vocab";
import { AP } from "../../config/activitypub.ts";
import { contentIdentifierOf } from "../../models/activitypub/object-id.ts";
import { record, remove } from "../interactions/comments.ts";
import * as reactions from "../interactions/reactions.ts";
import * as followerRows from "../interactions/followers.ts";
import { acceptFollowing, updateFollowing } from "./following.ts";
import { recordDeparture } from "../../signals/activitypub/departures.ts";
import { sendAccept } from "../../gateways/activitypub/outbound.ts";

import { handleFollow, handleUndoFollow, type FollowerStore, type Follower, type FollowActivity } from "./inbox-follow.ts";

const followerStore: FollowerStore = {
  add: followerRows.follow,
  remove: followerRows.unfollow,
  departure: (actorUrl) => recordDeparture(actorUrl, "unfollowed"),
};
const contentId = (url: string) => contentIdentifierOf(url, AP.actorHost, AP.user);

export async function receiveFollow(ctx: Context<void>, activity: FollowActivity,
  load: () => Promise<{ follower: Follower; recipient: Actor } | null>): Promise<void> {
  const ownActorId = ctx.getActorUri(AP.user).href;
  if (activity.objectId !== ownActorId || !activity.actorId) return;
  const loaded = await load();
  if (!loaded) return;
  // A fetched document cannot file its inbox under another signer's identity.
  if (loaded.follower.actorUrl !== activity.actorId) return;
  await handleFollow(activity, loaded.follower, ownActorId, followerStore,
    (accepted) => sendAccept(ctx, loaded.recipient, accepted));
}

export const receiveComment = (input: Parameters<typeof record>[0]) => record(input, contentId);
export const receiveReaction = (input: Parameters<typeof reactions.record>[0]) => reactions.record(input, contentId);

export async function receiveDelete(actorId: string, objectId: string): Promise<void> {
  if (objectId === actorId) {
    // Both lists must stop claiming a relationship with a deleted account.
    if (await followerRows.unfollow(actorId)) await recordDeparture(actorId, "deleted");
    await updateFollowing(actorId, false);
    return;
  }
  // The row survives withdrawal; a promoted copy is removed by its own operation.
  await remove(objectId, actorId);
}

export async function receiveAccept(ownActorId: string, actorId: string, follow: FollowActivity): Promise<void> {
  // Only our Follow, accepted by the actor we followed, can add to the list.
  if (follow.actorId !== ownActorId) return;
  if (follow.objectId && follow.objectId !== actorId) return;
  await acceptFollowing(actorId);
}

export async function receiveReject(ownActorId: string, actorId: string, follow: FollowActivity): Promise<void> {
  if (follow.actorId !== ownActorId) return;
  await updateFollowing(actorId, false);
}

export async function receiveUndo(actorId: string, objectId: string | null, embeddedFollow: boolean,
  loadFollow: () => Promise<FollowActivity | null>): Promise<void> {
  // Reactions use the signer and named activity, so another actor cannot undo
  // the row. An embedded Follow must bypass this lookup, even if it fails.
  if (!embeddedFollow && objectId) {
    if (await reactions.undo(actorId, objectId)) return;
  }
  const follow = await loadFollow();
  // Only the signer's row can be removed, whoever the embedded Follow names.
  if (follow) await handleUndoFollow(actorId, followerStore);
}
