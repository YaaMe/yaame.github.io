import { createFederation, exportJwk, generateCryptoKeyPair, importJwk } from "@fedify/fedify";
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
    const stored = await platform.get<{ priv: any; pub: any }>("ap:keypair");
    if (stored) {
      return [{
        privateKey: await importJwk(stored.priv, "private"),
        publicKey: await importJwk(stored.pub, "public"),
      }];
    }
    const { privateKey, publicKey } = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    await platform.put("ap:keypair", {
      priv: await exportJwk(privateKey), pub: await exportJwk(publicKey),
    });
    return [{ privateKey, publicKey }];
  });

federation
  .setInboxListeners(`/users/{identifier}/inbox`, "/inbox")
  // Fedify has already verified the signature and that the sender speaks for
  // the actor it names before a listener runs.
  .on(Follow, async (ctx, follow) => {
    if (follow.objectId?.href !== ctx.getActorUri(AP.user).href) return;
    const follower = await follow.getActor();
    if (!follower?.id) return;

    const list: string[] = (await platform.get<string[]>("ap:followers")) ?? [];
    if (!list.includes(follower.id.href)) {
      await platform.put("ap:followers", [follower.id.href, ...list]);
    }
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
    const list: string[] = (await platform.get<string[]>("ap:followers")) ?? [];
    await platform.put("ap:followers", list.filter((x) => x !== undo.actorId!.href));
  });

federation.setFollowersDispatcher(`/users/{identifier}/followers`, async (_ctx, identifier) => {
  if (identifier !== AP.user) return null;
  const list: string[] = (await platform.get<string[]>("ap:followers")) ?? [];
  return { items: list.map((href) => ({ id: new URL(href), inboxId: new URL(href + "/inbox") })) };
});
