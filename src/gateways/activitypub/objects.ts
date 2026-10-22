import type { Context } from "@fedify/fedify";
import { Temporal } from "@js-temporal/polyfill";
import { Create, Note, OrderedCollection } from "@fedify/fedify/vocab";
import { AP } from "../../config/activitypub.ts";
import { objectUrl } from "../../models/activitypub/object-id.ts";
import type { Item, Tally } from "../../models/activitypub/objects.ts";

export const PUBLIC = new URL("https://www.w3.org/ns/activitystreams#Public");

/**
 * One item, as an ActivityPub object.
 *
 * Built in one place because the outbox, the featured collection and the object
 * dispatcher all need it. Two constructions would drift, and the drift would
 * surface as a remote copy that disagrees with ours about our own post.
 *
 * The id and the url are different addresses on purpose. The blog cannot answer
 * as both: its pages are static assets served ahead of the Worker, so a request
 * for application/activity+json gets HTML no matter what it asked for.
 */
export const note = (ctx: Context<void>, item: Item, tally: Tally = { replies: 0, likes: 0, shares: 0 }) => {
  const id = objectUrl(AP.actorHost, AP.user, item.slug);
  return new Note({
    id,
    attribution: ctx.getActorUri(AP.user),
    url: item.url,
    to: PUBLIC,
    // Public posts are addressed to the followers as well, which is how every
    // other implementation spells "public, and my followers should see it".
    cc: ctx.getFollowersUri(AP.user),
    // Without this a receiving server supplies a date of its own, and the same
    // post is dated differently on every instance that holds it.
    //
    // The assertion reconciles two Temporals: Fedify's signature names an
    // ambient global that exists in neither runtime we deploy to, while the
    // polyfill it bundles produces an Instant that works. A string throws.
    published: Temporal.Instant.from(item.published) as unknown as ConstructorParameters<
      typeof Note
    >[0]["published"],
    // A reference with the count inline, not the items: that is what a reader
    // uses to decide whether the collection is worth fetching. The type must
    // match what the endpoint serves — a reference naming a different type is a
    // disagreement only a strict client notices, and only in production.
    replies: new OrderedCollection({
      id: new URL(`${id.href}/replies`),
      totalItems: tally.replies,
    }),
    // Counts with no id: there is no endpoint behind them, and advertising one
    // that 404s is worse than advertising nothing. AS2 makes both collections a
    // MAY and obliges a server to add to them only "if this collection is
    // present".
    //
    // So who liked or boosted a post stays unpublished, though it is held in
    // the database either way.
    likes: new OrderedCollection({ totalItems: tally.likes }),
    shares: new OrderedCollection({ totalItems: tally.shares }),
    content: item.content,
  });
};


export function create(ctx: Context<void>, object: Note, identifier: string = AP.user): Create {
  return new Create({
    // Alongside the object it wraps: an activity belongs to this actor, and
    // nothing on the blog would answer for it.
    id: new URL("#create", object.id!),
    actor: ctx.getActorUri(identifier),
    to: PUBLIC,
    object,
  });
}
