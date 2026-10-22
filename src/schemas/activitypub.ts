import type { RequestContext } from "@fedify/fedify";
import { Temporal } from "@js-temporal/polyfill";
import { Person, Endpoints, Image, PropertyValue, Note } from "@fedify/fedify/vocab";
import type { actorData, actorKeys } from "../selectors/activitypub/actor.ts";

export async function person(ctx: RequestContext<void>, data: ReturnType<typeof actorData>, keys: () => ReturnType<typeof actorKeys>) {
  const identifier = data.identifier;
  return new Person({
    id: ctx.getActorUri(identifier),
    preferredUsername: identifier,
    name: data.name,
    summary: data.summary,
    url: data.url,
    icon: new Image({ url: data.iconUrl, mediaType: "image/jpeg" }),
    attachments: data.attachments.map((value) => new PropertyValue(value)),
    inbox: ctx.getInboxUri(identifier),
    outbox: ctx.getOutboxUri(identifier),
    discoverable: data.discoverable,
    indexable: data.indexable,
    // Fedify names an ambient Temporal absent from both runtimes. The polyfill
    // supplies a working Instant; passing a string throws.
    published: Temporal.Instant.from(data.since) as unknown as ConstructorParameters<typeof Person>[0]["published"],
    manuallyApprovesFollowers: data.manuallyApprovesFollowers,
    // Mastodon never backfills a remote outbox; it fetches featured on discovery.
    featured: ctx.getFeaturedUri(identifier),
    followers: ctx.getFollowersUri(identifier),
    following: ctx.getFollowingUri(identifier),
    endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
    publicKeys: (await keys()).map((k) => k.cryptographicKey),
  });
}

export function followers(list: { identifier: string; inbox: string; sharedInbox: string | null }[]) {
  return list.map((f) => ({
    id: new URL(f.identifier),
    inboxId: new URL(f.inbox),
    // A shared inbox collapses fan-out to one POST per host.
    endpoints: f.sharedInbox ? { sharedInbox: new URL(f.sharedInbox) } : null,
  }));
}

export const following = (list: string[]) => list.map((href) => new URL(href));
export const replyObjects = (list: { objectId: string }[]) => list.map((c) => new Note({ id: new URL(c.objectId) }));

export const collectionPage = <T>({ items, next }: { items: T[]; next: number | null }) => ({
  items, nextCursor: next === null ? null : String(next),
});

export const nodeInfo = (localPosts: number) => ({
  software: { name: "blogu", version: "0.0.1" } as const,
  protocols: ["activitypub"] as ["activitypub"],
  usage: {
    users: { total: 1, activeMonth: 1, activeHalfyear: 1 },
    localPosts,
    // Incoming comments belong to users on other servers, not registered here.
    localComments: 0,
  },
});
