import type { Context } from "@fedify/fedify";
import { Accept, Follow, Undo, Update, type Activity, type Actor, type Person, type Note } from "@fedify/fedify/vocab";
import { AP } from "../../config/activitypub.ts";
import { PUBLIC, create, note } from "./objects.ts";
import type { Item, Tally } from "../../models/activitypub/objects.ts";

/**
 * An actor reduced to what delivery needs.
 *
 * `Actor` is a union of Person/Group/Service/…, and `sendActivity` resolves no
 * overload against a union.
 */
const recipientOf = (actor: Actor) => ({
  id: actor.id,
  inboxId: actor.inboxId,
  endpoints: actor.endpoints?.sharedInbox
    ? { sharedInbox: actor.endpoints.sharedInbox }
    : null,
});


export const sendToFollowers = (ctx: Context<void>, activity: Activity) =>
  ctx.sendActivity({ identifier: AP.user }, "followers", activity);

export function publication(ctx: Context<void>, item: Item, tally?: Tally) {
  const object = note(ctx, item, tally);
  return { target: item.slug, note: object, activity: create(ctx, object) };
}

export async function sendActorUpdate(ctx: Context<void>, person: Person, digest: string) {
  await sendToFollowers(ctx, new Update({
    // A repeated id is a repeated activity, so a deduplicating server would
    // otherwise drop the second change.
    id: new URL(`#update/${digest.slice(0, 12)}`, ctx.getActorUri(AP.user)),
    actor: ctx.getActorUri(AP.user),
    to: PUBLIC,
    // A bare URI makes the receiver fetch the document again.
    object: person,
  }));
}

export async function sendNoteUpdate(ctx: Context<void>, object: Note) {
  await sendToFollowers(ctx, new Update({
    id: new URL(`#update/${Date.now()}`, object.id!),
    actor: ctx.getActorUri(AP.user),
    to: PUBLIC,
    object,
  }));
}

const followId = (ctx: Context<void>, handle: string) =>
  new URL(`#follow/${encodeURIComponent(handle)}`, ctx.getActorUri(AP.user));

export async function sendFollow(ctx: Context<void>, actor: Actor, actorId: URL, handle: string) {
  await ctx.sendActivity({ identifier: AP.user }, recipientOf(actor), new Follow({
    id: followId(ctx, handle),
    actor: ctx.getActorUri(AP.user),
    object: actorId,
  }));
}

export async function sendUnfollow(ctx: Context<void>, actor: Actor, target: URL, handle: string) {
  await ctx.sendActivity({ identifier: AP.user }, recipientOf(actor), new Undo({
    id: new URL(`#unfollow/${encodeURIComponent(handle)}`, ctx.getActorUri(AP.user)),
    actor: ctx.getActorUri(AP.user),
    object: new Follow({
      id: followId(ctx, handle),
      actor: ctx.getActorUri(AP.user),
      object: target,
    }),
  }));
}

export async function sendAccept(ctx: Context<void>, recipient: NonNullable<Awaited<ReturnType<Follow["getActor"]>>>, accepted: {
  id: string | null; actorId: string | null; objectId: string;
}) {
  // Echoing the fetched Follow embeds its entire Person. A remote 202 does
  // not prove that the receiver matched that Accept to the pending Follow.
  await ctx.sendActivity({ identifier: AP.user }, recipient, new Accept({
    actor: ctx.getActorUri(AP.user),
    object: new Follow({
      id: accepted.id ? new URL(accepted.id) : null,
      actor: accepted.actorId ? new URL(accepted.actorId) : null,
      object: new URL(accepted.objectId),
    }),
  }));
}
