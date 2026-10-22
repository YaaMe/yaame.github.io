import type { Context } from "@fedify/fedify";
import type { Create } from "@fedify/fedify/vocab";
import { store } from "../../persistence/interactions/database.ts";
import { CHANNELS } from "../../models/interactions/key-scheme.ts";
import { deliverPending, type Pending } from "./delivery.ts";
import { publication, sendToFollowers } from "../../gateways/activitypub/outbound.ts";
import type { Item, Tally } from "../../models/activitypub/objects.ts";
import { reconcileFollowing } from "./following.ts";
import { announceEdits } from "../../signals/activitypub/content.ts";

/**
 * Send what has not been enqueued.
 *
 * Without the marks, every trigger would deliver the same Create again. Remote
 * servers de-duplicate by activity id and ours is stable, so the duplicates
 * would be discarded rather than shown twice — but they would still be a
 * delivery attempt per follower, every time.
 *
 * Only the slice the outbox publishes is considered: delivering something the
 * outbox does not offer leaves a follower holding a post they cannot find in
 * the collection it supposedly came from.
 *
 * A post whose enqueue fails is logged and left pending for the next build;
 * one whose identifier cannot be marked is logged and never sent; the outbox
 * is still served. What happens after the enqueue is the queue's
 * retries.
 *
 * Runs when the outbox is built, which after every deploy is the conformance
 * check fetching it. See
 * docs/decisions/0003-the-actor-announces-itself-when-it-is-built.md.
 */
async function publishPending(ctx: Context<void>, pending: Pending<Create>[]): Promise<void> {
  const { failed, refused, unmarked } = await deliverPending(await store(), CHANNELS.activitypub, pending, (activity) =>
    sendToFollowers(ctx, activity),
  );
  for (const { target, error } of failed) console.error("enqueue failed; the post stays pending", { target, error });
  for (const target of refused) console.error("not a content identifier; the post is never delivered", { target });
  for (const { target, error } of unmarked) console.error("sent but not marked; held back from sending again", { target, error });
}


export async function publishOutbox(ctx: Context<void>, items: Item[], tally: Map<string, Tally>): Promise<Create[]> {
  const publications = items.map((item) => publication(ctx, item, tally.get(item.slug)));
  // Every page triggers delivery for the whole published window.
  await publishPending(ctx, publications);
  // Intent arrives by deploy, whose conformance check fetches the outbox.
  await reconcileFollowing(ctx);
  await announceEdits(ctx, publications);
  return publications.map(({ activity }) => activity);
}
