import { createFederation, importJwk } from "@fedify/fedify";
// The vocabulary classes live on their own subpath — the root entry re-exports
// the machinery, not the ActivityStreams types.
import { Person, Follow, Undo, Accept, Endpoints, Image, PropertyValue } from "@fedify/fedify/vocab";
import { configure, getConsoleSink } from "@logtape/logtape";
import { platform } from "../../platform";
import { AP } from "./config";

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

federation
  .setActorDispatcher(`/users/{identifier}`, async (ctx, identifier) => {
    if (identifier !== AP.user) return null;

    return new Person({
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
      followers: ctx.getFollowersUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      publicKeys: (await ctx.getActorKeyPairs(identifier)).map((k) => k.cryptographicKey),
    });
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
  .on(Undo, async (_ctx, undo) => {
    const object = await undo.getObject();
    if (!(object instanceof Follow) || !undo.actorId) return;
    const list = await readFollowers();
    await platform.put("ap:followers", list.filter((f) => f.id !== undo.actorId!.href));
  });

federation.setFollowersDispatcher(`/users/{identifier}/followers`, async (_ctx, identifier) => {
  if (identifier !== AP.user) return null;
  const list = await readFollowers();
  return {
    items: list.map((f) => ({
      id: new URL(f.id),
      inboxId: new URL(f.inbox),
      // Fedify prefers this when fanning out, collapsing one POST per follower
      // on a shared host into one POST for all of them.
      endpoints: f.sharedInbox ? { sharedInbox: new URL(f.sharedInbox) } : null,
    })),
  };
});
