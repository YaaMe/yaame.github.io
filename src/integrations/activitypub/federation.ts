import { createFederation, importJwk, type RequestContext } from "@fedify/fedify";
// The vocabulary classes live on their own subpath — the root entry re-exports
// the machinery, not the ActivityStreams types.
import { Person, Follow, Undo, Accept, Create, Delete, Note, Update, Endpoints, Image, PropertyValue } from "@fedify/fedify/vocab";
import { configure, getConsoleSink } from "@logtape/logtape";
import { platform } from "../../platform";
import { AP } from "./config";
import { record, remove } from "./store/comments";
import { FIRST, page } from "./paging";

/**
 * Fedify does the parts that are tedious to get right and easy to get subtly
 * wrong: WebFinger, HTTP Signatures on both directions, the JSON-LD contexts,
 * delivery with retries, and the behavioural quirks of each implementation it
 * is tested against.
 */
// Fedify reports what it is doing through LogTape, and without a sink it
// reports it to nobody. Everything below the application — signature
// verification, delivery, its own retries — is otherwise invisible, which is
// how an ordering-key problem cost an afternoon.
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
  // inline and a failure is final. Both are real behaviours, and which applies
  // is a property of the host, not of this file.
  ...(platform.queue ? { queue: platform.queue } : {}),

  // The handle's domain and the actor's home are deliberately different: the
  // first stays on its own DNS and serves one static WebFinger document, the
  // second is where anything that has to run actually runs. Fedify emits the
  // canonical handle for one and builds every URL against the other.
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
 * keeps deciding things long after — the avatar it shows, whether the account
 * is discoverable, whether the follower list is hidden at all. Ours was wrong
 * on two instances for a day before it was possible to see why.
 *
 * This ran on a timer first, which was the wrong shape: "the actor changed" is
 * not a state that needs polling for. It has an exact moment, and this is it —
 * a document that has been built is the only way it becomes a fact. Putting the
 * comparison here also makes a manual announcement a plain GET of the actor,
 * with nothing to invoke and no second mechanism to keep working.
 *
 * Sending on every deploy would push a message to every follower's server for
 * builds that changed nothing here, so the document is fingerprinted: an Update
 * goes out when the fingerprint moves, and never otherwise.
 */
async function announceIfChanged(ctx: RequestContext<void>, person: Person): Promise<void> {
  const document = JSON.stringify(await person.toJsonLd({ format: "compact" }));
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document))),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if ((await platform.get<string>("ap:actor-digest")) === digest) return;

  // Written before sending, so a delivery that fails does not leave the
  // fingerprint behind and announce again on the next fetch.
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
 * A prefix test rather than a lookup: our notes are addressed by the dispatcher
 * in outbox.ts, and asking the content layer would drag astro:content into the
 * queue consumer, which cannot resolve it.
 */
const OURS = `https://${AP.actorHost}/users/${AP.user}/notes/`;
const ours = (id: string) => id.startsWith(OURS);

/**
 * Drop a follower whose inbox has been written off.
 *
 * ActivityPub §7.5 says it is reasonable to remove a subscriber whose server
 * cannot be reached. Without this the write-off only records the failure: the
 * follower stays on the list, and the next thing we publish spends another hour
 * of retries on the same dead address, for as long as the list is never read by
 * a person.
 *
 * Only a personal inbox prunes. A shared inbox stands for everyone on that host,
 * and one failed delivery to it is not evidence about any particular follower —
 * removing them all would turn a remote outage into a silent loss of an
 * audience.
 */
export async function dropFollowerByInbox(inbox: string): Promise<string | null> {
  const list = await readFollowers();
  const gone = list.find((f) => f.inbox === inbox);
  if (!gone) return null;
  await platform.put("ap:followers", list.filter((f) => f.inbox !== inbox));
  return gone.id;
}

/**
 * An inbox that is gone, rather than one that is having a bad day.
 *
 * Fedify treats 404 and 410 as permanent and stops retrying — correctly, since
 * a server that says "no such actor" will keep saying it. But that also means
 * nothing throws, so the consumer's write-off path never runs and the follower
 * stayed on the list: we watched a deleted account collect a delivery on every
 * publish, with the failure visible only in a log nobody reads.
 *
 * The retry ceiling covers the other shape — an address that keeps timing out —
 * and is no help here. This is the shape where we are told.
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

    // The actor key is RSA because that is what the classic actor publicKey
    // field requires; it is separate from the OpenPGP identity, which is
    // ed25519 and never leaves hardware.
    // Read, never generated. Generating on a miss makes a misconfigured binding
    // — or one failed read — indistinguishable from a first run, and answers
    // both by minting a new identity: every follower is left holding a key that
    // no longer matches, and nothing reports it. There is no way to tell those
    // cases apart from in here, so the decision is not made here at all. The
    // key is placed by hand, once, and an absent one fails every time.
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

// Entries written before the inbox was stored are bare actor URIs, and keep the
// old assumption: their real inbox is no longer at hand, and is recovered the
// next time that follower sends anything.
const readFollowers = async (): Promise<Follower[]> => {
  // Annotated rather than inferred: `(T[] | null) ?? []` is a union of two array
  // types, and `.map` resolves no overload against a union — leaving its
  // parameter an implicit any.
  const stored: (Follower | string)[] =
    (await platform.get<(Follower | string)[]>("ap:followers")) ?? [];
  return stored.map((f) => (typeof f === "string" ? { id: f, inbox: `${f}/inbox` } : f));
};

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
    // The Follow is rebuilt from its three identifiers rather than echoed.
    // Echoing it serialises whatever the object is carrying, and getActor()
    // above has just filled it with the sender's entire Person — so object.actor
    // goes out as several kilobytes of inlined document where a URI belongs.
    //
    // This shape is the one verified end to end against Mastodon, against both
    // the personal inbox and a clean instance. The remote end answers 202
    // whether or not it could match the Accept to the request it is waiting on,
    // so nothing here can tell a working delivery from a useless one.
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
  // A server announcing that an account is gone. Without this the follower stays
  // on the list for good, and every post is delivered to an inbox that no longer
  // exists — which now costs an hour of retries each time before being written
  // off, and never stops recurring.
  //
  // Only a self-delete is of interest: object equal to actor. Anything else is a
  // post being deleted, and no posts of anyone else's are kept here.
  // A reply. Until now these arrived and were dropped: the sender's server
  // reported success, the person saw their reply posted, and nothing on this
  // side kept it or said so.
  //
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
        // Date rather than Temporal for the fallback: Fedify hands us a
        // Temporal.Instant when the sender supplied one, but constructing one
        // ourselves would depend on Temporal being present in the runtime,
        // which is a different question from the type existing.
        published: object.published?.toString() ?? new Date().toISOString(),
      },
      ours,
    );
  })
  .on(Delete, async (_ctx, del) => {
    if (!del.actorId || !del.objectId) return;

    // The account itself. Without this the follower stays on the list for good,
    // and every post is delivered to an inbox that no longer exists.
    if (del.objectId.href === del.actorId.href) {
      const list = await readFollowers();
      await platform.put("ap:followers", list.filter((f) => f.id !== del.actorId!.href));
      return;
    }

    // Otherwise a comment. ActivityPub §7.4 says we SHOULD remove our
    // representation; the row survives as a record that something was here, and
    // if it was carried into git the removal there is raised against it.
    await remove(del.objectId.href, del.actorId.href);
  })
  .on(Undo, async (_ctx, undo) => {
    const object = await undo.getObject();
    if (!(object instanceof Follow) || !undo.actorId) return;
    const list = await readFollowers();
    await platform.put("ap:followers", list.filter((f) => f.id !== undo.actorId!.href));
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
 * Who this actor follows: nobody, so far.
 *
 * Served anyway, and read from storage rather than returned as a literal empty
 * list. The actor advertises the collection, and an advertised endpoint that
 * answers 404 is the defect this pass is about. Reading the same key an Accept
 * handler would one day write means the answer stops being empty on its own,
 * rather than needing this to be found and changed.
 */

const readFollowing = async (): Promise<string[]> =>
  (await platform.get<string[]>("ap:following")) ?? [];

federation
  .setFollowingDispatcher(`/users/{identifier}/following`, async (_ctx, identifier, cursor) => {
    if (identifier !== AP.user) return null;
    return page((await readFollowing()).map((href) => new URL(href)), cursor);
  })
  .setCounter(async (_ctx, identifier) =>
    identifier === AP.user ? (await readFollowing()).length : null,
  )
  .setFirstCursor(FIRST);
