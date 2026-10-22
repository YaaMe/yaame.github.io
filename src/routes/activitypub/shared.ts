import { Follow, Undo, Accept, Announce, Create, Delete, Like, Reject } from "@fedify/fedify/vocab";
import { AP } from "../../config/activitypub.ts";
import { federation, registerOnce } from "../../services/activitypub/runtime.ts";
import { dropFollowersAt } from "../../services/activitypub/followers.ts";
import { announceIfChanged } from "../../services/activitypub/actor.ts";
import * as inbox from "../../services/activitypub/inbox.ts";
import { actorData, actorKeys, keyPairs } from "../../selectors/activitypub/actor.ts";
import { allFollowers } from "../../selectors/activitypub/followers.ts";
import { readFollowing } from "../../selectors/activitypub/following.ts";
import { resolveActor, resolveObject, embeddedObject } from "../../selectors/activitypub/objects.ts";
import { followInput, followerInput, commentInput, reactionInput, followReply, isFollow } from "../../params/activitypub.ts";
import { FIRST, PAGE_SIZE, parseCursor } from "../../params/activitypub-paging.ts";
import { page } from "../../lib/page.ts";
import { person, followers, following, collectionPage } from "../../schemas/activitypub.ts";
import { isLocalActor } from "./actor.ts";

export const installShared = (): void => registerOnce("shared", registerShared);

function registerShared(): void {
  // Fedify stops retrying 404/410 itself, so the exhausted-retry path never
  // sees these permanently dead inboxes.
  federation.setOutboxPermanentFailureHandler(async (_ctx, { reason, inbox, activity, actorIds }) => {
    const dropped = await dropFollowersAt(inbox.href, actorIds.map((id) => id.href), String(reason));
    console.warn("permanent delivery failure", { reason, inbox: inbox.href, activity: activity.id?.href, dropped });
  });

  federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (!isLocalActor(identifier)) return null;
    const data = actorData(identifier);
    const actor = await person(ctx, data, () => actorKeys(ctx, identifier));
    await announceIfChanged(ctx, actor);
    return actor;
  }).setKeyPairsDispatcher(async (_ctx, identifier) => keyPairs(identifier));

  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    // Fedify verifies the signature and the sender's authority before dispatch.
    .on(Follow, async (ctx, activity) => {
      await inbox.receiveFollow(ctx, followInput(activity),
        async () => followerInput(activity, await resolveActor(activity)));
    })
    .on(Create, async (_ctx, activity) => {
      const input = commentInput(activity, await resolveObject(activity));
      if (input) await inbox.receiveComment(input);
    })
    .on(Announce, async (_ctx, activity) => {
      const input = reactionInput(activity, "Announce");
      if (input) await inbox.receiveReaction(input);
    })
    .on(Like, async (_ctx, activity) => {
      const input = reactionInput(activity, "Like");
      if (input) await inbox.receiveReaction(input);
    })
    .on(Delete, async (_ctx, activity) => {
      if (!activity.actorId || !activity.objectId) return;
      await inbox.receiveDelete(activity.actorId.href, activity.objectId.href);
    })
    .on(Accept, async (ctx, activity) => {
      const object = followReply(await resolveObject(activity));
      if (!object || !activity.actorId) return;
      await inbox.receiveAccept(ctx.getActorUri(AP.user).href, activity.actorId.href, object);
    })
    .on(Reject, async (ctx, activity) => {
      const object = followReply(await resolveObject(activity));
      if (!object || !activity.actorId) return;
      await inbox.receiveReject(ctx.getActorUri(AP.user).href, activity.actorId.href, object);
    })
    .on(Undo, async (_ctx, activity) => {
      if (!activity.actorId) return;
      const embedded = await embeddedObject(activity);
      await inbox.receiveUndo(activity.actorId.href, activity.objectId?.href ?? null, isFollow(embedded),
        async () => followReply(embedded ?? await resolveObject(activity)));
    });

  federation.setFollowersDispatcher("/users/{identifier}/followers", async (_ctx, identifier, cursor) => {
    if (!isLocalActor(identifier)) return null;
    const list = followers(await allFollowers());
    // Fan-out keeps only the returned items. Paging a null cursor would silently
    // drop every recipient beyond the first twenty; HTTP readers get FIRST.
    return cursor === null ? { items: list, nextCursor: null }
      : collectionPage(page(list, parseCursor(cursor), PAGE_SIZE));
  }).setCounter(async (_ctx, identifier) => isLocalActor(identifier) ? (await allFollowers()).length : null)
    .setFirstCursor(FIRST);

  // The actor advertises this collection; a 404 would describe a broken actor.
  federation.setFollowingDispatcher("/users/{identifier}/following", async (_ctx, identifier, cursor) => {
    if (!isLocalActor(identifier)) return null;
    return collectionPage(page(following(await readFollowing()), parseCursor(cursor), PAGE_SIZE));
  }).setCounter(async (_ctx, identifier) => isLocalActor(identifier) ? (await readFollowing()).length : null)
    .setFirstCursor(FIRST);
}
