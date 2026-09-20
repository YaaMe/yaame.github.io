import { createFederation, importJwk, type RequestContext } from "@fedify/fedify";
import { Temporal } from "@js-temporal/polyfill";
import { Person, Follow, Undo, Accept, Announce, Create, Delete, Like, Note, Reject, Update, Endpoints, Image, PropertyValue, isActor, type Actor } from "@fedify/fedify/vocab";
import { configure, getConsoleSink } from "@logtape/logtape";
import { platform } from "../../platform";
import { AP } from "./config";
import intentJson from "./following.json";

/** Annotated because the two bundlers infer this JSON import's shape differently. */
const intent = intentJson as { follow: string[] };
import { record, remove } from "./store/comments";
import * as reactions from "./store/reactions";
import { FIRST, page } from "./paging";

// Without a sink, everything below the application — signature verification,
// delivery, Fedify's own retries — reports to nobody.
await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: "fedify", sinks: ["console"], lowestLevel: "info" },
    { category: ["logtape", "meta"], sinks: [], lowestLevel: "error" },
  ],
});

export const federation = createFederation<void>({
  kv: platform.kv,

  // With a queue, delivery is retried with backoff; without one it is sent
  // inline and a failure is final. Which applies is a property of the host.
  ...(platform.queue ? { queue: platform.queue } : {}),

  // Two hosts on purpose: the handle's domain serves one static WebFinger
  // document, the actor's home runs everything else. Fedify emits the canonical
  // handle for the first and builds every URL against the second.
  origin: {
    handleHost: AP.handleHost,
    webOrigin: `https://${AP.actorHost}`,
  },
});

/**
 * Tell the followers when the actor changes, at the moment it changes.
 *
 * Nothing re-reads an actor because we edited it. Mastodon refreshes remote
 * accounts lazily, on the order of a day, and what it stored at first fetch
 * keeps deciding the avatar it shows and whether the follower list is hidden.
 *
 * The document is fingerprinted, so an Update goes out when it moves and never
 * otherwise: without that, every deploy pushes a message to every follower's
 * server for builds that changed nothing here.
 *
 * See docs/decisions/0003-the-actor-announces-itself-when-it-is-built.md.
 */
async function announceIfChanged(ctx: RequestContext<void>, person: Person): Promise<void> {
  const document = JSON.stringify(await person.toJsonLd({ format: "compact" }));
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document))),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if ((await platform.get<string>("ap:actor-digest")) === digest) return;

  // Written before sending: a failed delivery is not retried, which is the
  // trade against announcing on every fetch until one succeeds.
  await platform.put("ap:actor-digest", digest);
  await ctx.sendActivity(
    { identifier: AP.user },
    "followers",
    new Update({
      // Unique per announcement: a repeated id is a repeated activity, and a
      // server that deduplicates would drop the second change.
      id: new URL(`#update/${digest.slice(0, 12)}`, ctx.getActorUri(AP.user)),
      actor: ctx.getActorUri(AP.user),
      to: new URL("https://www.w3.org/ns/activitystreams#Public"),
      // Embedded rather than a URI: Mastodon dereferences a bare one, and the
      // document is small enough that making them fetch it buys nothing.
      object: person,
    }),
  );
}

/**
 * Whether an object id is one of ours.
 *
 * A prefix test, not a lookup: asking the content layer would pull
 * `astro:content` into the queue consumer, which cannot resolve it.
 */
const OURS = `https://${AP.actorHost}/users/${AP.user}/notes/`;
const ours = (id: string) => id.startsWith(OURS);

/**
 * Drop a follower whose inbox has been written off (ActivityPub §7.5).
 *
 * Without this the follower stays on the list and every later publish spends
 * another hour of retries on the same dead address.
 *
 * The match is on the personal inbox only. A shared inbox stands for everyone
 * on that host, so one failed delivery to it is not evidence about any
 * particular follower — pruning on it would turn a remote outage into a silent
 * loss of the audience.
 */
export async function dropFollowerByInbox(inbox: string): Promise<string | null> {
  const list = await readFollowers();
  const gone = list.find((f) => f.inbox === inbox);
  if (!gone) return null;
  await platform.put("ap:followers", list.filter((f) => f.inbox !== inbox));
  return gone.id;
}

/**
 * An inbox that is gone, rather than one having a bad day.
 *
 * Fedify treats 404 and 410 as permanent and stops retrying, so nothing throws
 * and the write-off path around delivery never runs. Without this handler a
 * deleted account keeps collecting a delivery on every publish, with the
 * failure visible only in a log.
 *
 * The retry ceiling covers the other shape, an address that keeps timing out.
 */
federation.setOutboxPermanentFailureHandler(async (_ctx, { reason, inbox, activity }) => {
  const dropped = await dropFollowerByInbox(inbox.href);
  console.warn("permanent delivery failure", {
    reason,
    inbox: inbox.href,
    activity: activity.id?.href,
    dropped,
  });
});

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

/**
 * Make the followed set match the intent written in git.
 *
 * The comparison is against `ap:follow-intent`, the record of what we have
 * sent, not against `ap:following`:
 *
 *   intended, sent       → nothing
 *   intended, not sent   → send Follow
 *   not intended, sent   → send Undo, and drop from following
 *   not intended, unsent → nothing
 *
 * See docs/decisions/0004-follow-reconciliation-pivots-on-what-was-sent.md.
 *
 * That same table holds each handle's resolved actor, so an intent deleted from
 * git still says who the Undo goes to.
 *
 * This half cannot run in CI: sending a Follow needs the signing key, which
 * exists only in the Worker's environment. The half that writes git — comment
 * tombstones, note promotion — cannot run here, for the mirror reason.
 */
export async function reconcileFollowing(ctx: RequestContext<void>): Promise<void> {
  const wanted = new Set(intent.follow);
  // Annotated, not inferred: `Record | null` with `?? {}` is a union of two
  // types, and `Object.entries` resolves no overload against a union.
  const resolved: Record<string, string> =
    (await platform.get<Record<string, string>>("ap:follow-intent")) ?? {};
  let changed = false;

  for (const handle of wanted) {
    if (resolved[handle]) continue;
    const found = await ctx.lookupObject(handle);
    // Unresolvable: retried on the next pass. A temporarily unreachable host
    // and a mistyped handle are indistinguishable from here.
    if (found === null || !isActor(found) || found.id === null) continue;
    const actor = found;
    // Held separately: narrowing on `found.id` does not follow a new binding.
    const actorId = found.id;
    resolved[handle] = actorId.href;
    changed = true;
    await ctx.sendActivity(
      { identifier: AP.user },
      recipientOf(actor),
      new Follow({
        id: new URL(`#follow/${encodeURIComponent(handle)}`, ctx.getActorUri(AP.user)),
        actor: ctx.getActorUri(AP.user),
        object: actorId,
      }),
    );
  }

  for (const [handle, actorId] of Object.entries(resolved)) {
    if (wanted.has(handle)) continue;
    delete resolved[handle];
    changed = true;
    const found = await ctx.lookupObject(actorId);
    if (found !== null && isActor(found) && found.id !== null) {
      const actor = found;
      const target = found.id;
      await ctx.sendActivity(
        { identifier: AP.user },
        recipientOf(actor),
        new Undo({
          id: new URL(`#unfollow/${encodeURIComponent(handle)}`, ctx.getActorUri(AP.user)),
          actor: ctx.getActorUri(AP.user),
          object: new Follow({
            id: new URL(`#follow/${encodeURIComponent(handle)}`, ctx.getActorUri(AP.user)),
            actor: ctx.getActorUri(AP.user),
            object: target,
          }),
        }),
      );
    }
    // Dropped without waiting for a reply: an Undo has no Accept, so sending it
    // is the whole of the change on our side.
    const list = await readFollowing();
    await platform.put("ap:following", list.filter((href) => href !== actorId));
  }

  if (changed) await platform.put("ap:follow-intent", resolved);
}

federation
  .setActorDispatcher(`/users/{identifier}`, async (ctx, identifier) => {
    if (identifier !== AP.user) return null;

    const person = new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: "yaame",
      // HTML, not prose — Mastodon renders this as markup, so a link written
      // here is a link. Plain text shows as text with nothing to click.
      summary:
        '<p>随笔、年结月结，以及一部还在写的小说，都在 ' +
        `<a href="${AP.blogUrl}/">${new URL(AP.blogUrl).host}</a>。</p>`,

      url: new URL(AP.blogUrl),

      // Served from this repository rather than hotlinked: the avatar is part of
      // the identity, and a third party's URL can change or disappear under it.
      icon: new Image({
        url: new URL("/images/avatar.jpg", AP.blogUrl),
        mediaType: "image/jpeg",
      }),

      // The profile's metadata rows, and the only place a link can be marked
      // verified: the remote server fetches the target and looks for a rel="me"
      // pointing back at this actor. That reciprocity is the whole check.
      attachments: [
        new PropertyValue({
          name: "Blog",
          value: `<a rel="me" href="${AP.blogUrl}/">${new URL(AP.blogUrl).host}</a>`,
        }),
        new PropertyValue({
          name: "Code",
          value: '<a rel="me" href="https://github.com/YaaMe">github.com/YaaMe</a>',
        }),
        new PropertyValue({
          name: "OpenPGP",
          value: "AD14 E098 99EC A2C4 0D51 8CCB 279F 27B4 6C46 47E3",
        }),
      ],
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      discoverable: AP.discoverable,
      indexable: AP.indexable,
      // The assertion reconciles two Temporals, as the notes' `published` does:
      // Fedify's signature names an ambient global that exists in neither
      // runtime we deploy to, while the polyfill it bundles produces an Instant
      // that works. A string throws.
      published: Temporal.Instant.from(AP.since) as unknown as ConstructorParameters<
        typeof Person
      >[0]["published"],
      manuallyApprovesFollowers: AP.manuallyApprovesFollowers,
      // The only way a new visitor sees anything at once: Mastodon never
      // backfills a remote outbox, and fetches this collection when it
      // processes the actor.
      featured: ctx.getFeaturedUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      following: ctx.getFollowingUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      publicKeys: (await ctx.getActorKeyPairs(identifier)).map((k) => k.cryptographicKey),
    });

    await announceIfChanged(ctx, person);
    return person;
  })
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    if (identifier !== AP.user) return [];

    // RSA because the classic actor `publicKey` field requires it. Separate
    // from the OpenPGP identity, which is ed25519 and never leaves hardware.
    //
    // Read, never generated: an absent key fails every request rather than
    // minting a new identity, which would leave every follower holding a key
    // that no longer matches. See
    // docs/decisions/0005-the-signing-key-is-read-never-generated.md.
    const raw = platform.secret("AP_KEY_JWK");
    if (!raw) throw new Error("AP_KEY_JWK is not set");
    const { priv, pub } = JSON.parse(raw) as { priv: JsonWebKey; pub: JsonWebKey };
    return [{
      privateKey: await importJwk(priv, "private"),
      publicKey: await importJwk(pub, "public"),
    }];
  });

/**
 * A follower, as much of it as delivery needs.
 *
 * The inbox is stored, not derived. `<actor>/inbox` is Mastodon's layout rather
 * than a rule, and deriving it posts to a 404 on anything that chose otherwise —
 * silently, because delivery is asynchronous and no one is waiting on the answer.
 */
type Follower = { id: string; inbox: string; sharedInbox?: string };

// Some stored entries are bare actor URIs. Their real inbox is not at hand, so
// the derived one stands until that follower next sends something.
const readFollowers = async (): Promise<Follower[]> => {
  // Annotated, not inferred: `(T[] | null) ?? []` is a union of two array types,
  // and `.map` resolves no overload against a union.
  const stored: (Follower | string)[] =
    (await platform.get<(Follower | string)[]>("ap:followers")) ?? [];
  return stored.map((f) => (typeof f === "string" ? { id: f, inbox: `${f}/inbox` } : f));
};

const readFollowing = async (): Promise<string[]> =>
  (await platform.get<string[]>("ap:following")) ?? [];

federation
  .setInboxListeners(`/users/{identifier}/inbox`, "/inbox")
  // Fedify has already verified the signature and that the sender speaks for
  // the actor it names before a listener runs.
  .on(Follow, async (ctx, follow) => {
    if (follow.objectId?.href !== ctx.getActorUri(AP.user).href) return;
    const follower = await follow.getActor();
    // No inbox means nothing can be delivered to them, the Accept below
    // included — so there is nothing to record either.
    if (!follower?.id || !follower.inboxId) return;

    const entry: Follower = {
      id: follower.id.href,
      inbox: follower.inboxId.href,
      ...(follower.endpoints?.sharedInbox
        ? { sharedInbox: follower.endpoints.sharedInbox.href }
        : {}),
    };
    // Replaced rather than skipped when already present: a repeat Follow is how
    // a moved inbox reaches us.
    const list = await readFollowers();
    await platform.put("ap:followers", [entry, ...list.filter((f) => f.id !== entry.id)]);
    // Rebuilt from its three identifiers, not echoed: echoing serialises
    // whatever the object carries, and the actor fetched above fills it with
    // the sender's entire Person, so `object.actor` goes out as kilobytes of
    // inlined document where a URI belongs.
    //
    // A remote end answers 202 whether or not it could match the Accept to the
    // request it is waiting on, so a useless delivery looks like a working one.
    const accept = new Accept({
      actor: ctx.getActorUri(AP.user),
      object: new Follow({
        id: follow.id,
        actor: follow.actorId,
        object: ctx.getActorUri(AP.user),
      }),
    });

    await ctx.sendActivity({ identifier: AP.user }, follower, accept);
  })
  // Only replies to something of ours are kept. A Create can address us for
  // other reasons — a mention with no reply target, a post merely delivered to
  // the shared inbox — and storing those would make this a mailbox for anything
  // pointed at us rather than the comments under our posts.
  .on(Create, async (_ctx, create) => {
    const object = await create.getObject();
    if (!(object instanceof Note)) return;
    if (!create.id || !object.id || !object.replyTargetId) return;

    const author = object.attributionId ?? create.actorId;
    if (!author) return;

    await record(
      {
        activityId: create.id.href,
        objectId: object.id.href,
        replyToId: object.replyTargetId.href,
        actorId: author.href,
        content: object.content?.toString() ?? "",
        // `Date` for the fallback: constructing a Temporal.Instant would
        // require Temporal in the runtime, which is a different question from
        // the type existing.
        published: object.published?.toString() ?? new Date().toISOString(),
      },
      ours,
    );
  })
  .on(Announce, async (_ctx, announce) => {
    if (!announce.id || !announce.actorId || !announce.objectId) return;
    await reactions.record(
      {
        activityId: announce.id.href,
        objectId: announce.objectId.href,
        actorId: announce.actorId.href,
        kind: "Announce",
      },
      ours,
    );
  })
  .on(Like, async (_ctx, like) => {
    if (!like.id || !like.actorId || !like.objectId) return;
    await reactions.record(
      {
        activityId: like.id.href,
        objectId: like.objectId.href,
        actorId: like.actorId.href,
        kind: "Like",
      },
      ours,
    );
  })
  .on(Delete, async (_ctx, del) => {
    if (!del.actorId || !del.objectId) return;

    // The account itself. Without this the follower stays on the list for good,
    // and every post is delivered to an inbox that no longer exists.
    if (del.objectId.href === del.actorId.href) {
      const gone = del.actorId.href;
      // Both lists. Dropping only from followers leaves us publicly claiming to
      // follow someone who no longer exists.
      const [followers, following] = await Promise.all([readFollowers(), readFollowing()]);
      await platform.put("ap:followers", followers.filter((f) => f.id !== gone));
      await platform.put("ap:following", following.filter((href) => href !== gone));
      return;
    }

    // Otherwise a comment. ActivityPub §7.4 says we SHOULD remove our
    // representation; the row survives as a record that something was here, and
    // if it was carried into git the removal there is raised against it.
    await remove(del.objectId.href, del.actorId.href);
  })
  // Without this half `ap:following` stays empty for good: Follows go out, no
  // agreement is ever recorded, and the public collection says we follow nobody.
  .on(Accept, async (ctx, accept) => {
    const object = await accept.getObject();
    if (!(object instanceof Follow) || !accept.actorId) return;

    // The accepted Follow must be one of ours. Without this, anyone can send an
    // Accept and have a stranger recorded as followed.
    if (object.actorId?.href !== ctx.getActorUri(AP.user).href) return;
    // And the accepting actor must be the one that was followed, or one party
    // can agree on another's behalf.
    if (object.objectId && object.objectId.href !== accept.actorId.href) return;

    // A late Accept must not revive an unfollow. The Undo may already have been
    // sent and the intent dropped; without this guard `following` gains someone
    // we do not follow, and reconciliation will not remove them — its record of
    // what was sent is already clean.
    const sent = (await platform.get<Record<string, string>>("ap:follow-intent")) ?? {};
    if (!Object.values(sent).includes(accept.actorId.href)) return;

    const list = await readFollowing();
    if (list.includes(accept.actorId.href)) return;
    await platform.put("ap:following", [accept.actorId.href, ...list]);
  })
  // A refusal, or an agreement withdrawn afterwards: the same outcome.
  .on(Reject, async (ctx, reject) => {
    const object = await reject.getObject();
    if (!(object instanceof Follow) || !reject.actorId) return;
    if (object.actorId?.href !== ctx.getActorUri(AP.user).href) return;

    const list = await readFollowing();
    await platform.put("ap:following", list.filter((href) => href !== reject.actorId!.href));
  })
  .on(Undo, async (_ctx, undo) => {
    const object = await undo.getObject();
    if (!undo.actorId) return;

    if (object instanceof Follow) {
      const list = await readFollowers();
      await platform.put("ap:followers", list.filter((f) => f.id !== undo.actorId!.href));
      return;
    }

    // Without this the counts only ever rise, and someone who changed their
    // mind stays counted for good.
    //
    // Narrowed on the concrete classes: `Object` has no `objectId`.
    if (object instanceof Announce || object instanceof Like) {
      const target = object.objectId;
      if (!target) return;
      await reactions.undo(
        target.href,
        undo.actorId.href,
        object instanceof Announce ? "Announce" : "Like",
      );
    }
  });

federation.setFollowersDispatcher(`/users/{identifier}/followers`, async (_ctx, identifier, cursor) => {
  if (identifier !== AP.user) return null;
  const list = await readFollowers();
  return page(
    list.map((f) => ({
      id: new URL(f.id),
      inboxId: new URL(f.inbox),
      // Fedify prefers this when fanning out, collapsing one POST per follower
      // on a shared host into one POST for all of them.
      endpoints: f.sharedInbox ? { sharedInbox: new URL(f.sharedInbox) } : null,
    })),
    cursor,
  );
})
  // Without a counter the collection carries no totalItems — and a follower
  // count is what most software displays, as zero.
  .setCounter(async (_ctx, identifier) =>
    identifier === AP.user ? (await readFollowers()).length : null,
  )
  .setFirstCursor(FIRST);

/**
 * The actor advertises this collection, so it must answer: an advertised
 * endpoint that 404s is read as a broken actor, not as an empty list.
 */

federation
  .setFollowingDispatcher(`/users/{identifier}/following`, async (_ctx, identifier, cursor) => {
    if (identifier !== AP.user) return null;
    return page((await readFollowing()).map((href) => new URL(href)), cursor);
  })
  .setCounter(async (_ctx, identifier) =>
    identifier === AP.user ? (await readFollowing()).length : null,
  )
  .setFirstCursor(FIRST);
