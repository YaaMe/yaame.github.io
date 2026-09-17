/**
 * The outbox, kept apart from federation.ts.
 *
 * It reads the posts, which means astro:content, which exists only inside an
 * Astro build. The queue consumer is a plain Worker and cannot resolve it — so
 * everything the consumer needs stays in federation.ts, and everything that
 * needs the content lives here, imported only from the Astro side.
 */
import { Create, Note } from "@fedify/fedify/vocab";
import { federation } from "./federation";
import { AP } from "./config";
import { allPosts, href } from "../../lib/posts";

const PUBLIC = new URL("https://www.w3.org/ns/activitystreams#Public");

/**
 * How much of the archive the outbox publishes.
 *
 * One, for now: the shape is the same for the whole archive, and publishing the
 * back catalogue at once would deliver sixteen notifications to anyone who
 * follows, which is not how anyone wants to meet an account. Named because the
 * counter below has to agree with it — a total that disagrees with the items it
 * counts is worse than no total.
 */
const PUBLISHED = 1;

/**
 * The outbox is derived from the posts, not accumulated in storage.
 *
 * The content lives in git, so the activity history is a projection of it: the
 * same commits produce the same outbox, and there is no second copy to drift.
 * Only what arrives from outside — followers, and later replies — needs to be
 * stored.
 */
federation.setOutboxDispatcher(`/users/{identifier}/outbox`, async (ctx, identifier) => {
  if (identifier !== AP.user) return null;

  const posts = (await allPosts()).slice(0, PUBLISHED);

  return {
    items: posts.map((post) => {
      const url = new URL(href(post), AP.blogUrl);
      return new Create({
        id: new URL("#create", url),
        actor: ctx.getActorUri(identifier),
        to: PUBLIC,
        object: new Note({
          id: url,
          attribution: ctx.getActorUri(identifier),
          url,
          to: PUBLIC,
          content:
            `<p><strong>${post.data.title}</strong></p>` +
            (post.data.description ? `<p>${post.data.description}</p>` : "") +
            `<p><a href="${url}">${url}</a></p>`,
        }),
      });
    }),
  };
}).setCounter(async (_ctx, identifier) =>
  identifier === AP.user ? Math.min((await allPosts()).length, PUBLISHED) : null,
);

/**
 * NodeInfo.
 *
 * Registered here rather than in federation.ts because the post count comes from
 * the content. It was previously not registered at all, which left
 * /.well-known/nodeinfo advertising an empty list of links while the route it
 * would have pointed at answered 404 — a discovery document that discovered
 * nothing.
 */
federation.setNodeInfoDispatcher("/nodeinfo/2.1", async () => ({
  // NodeInfo requires a version string and this software has none — package.json
  // carries no version field. 0.0.0 is the conventional way to say unversioned,
  // and is preferable to inventing a release number nobody cut.
  software: { name: "blogu", version: "0.0.0" },
  protocols: ["activitypub"],
  usage: {
    users: { total: 1, activeMonth: 1, activeHalfyear: 1 },
    localPosts: (await allPosts()).length,
    // Zero, and honestly so: nothing inbound is stored yet. The inbox listens
    // for Follow, Undo and Delete, and a reply arriving here is dropped.
    localComments: 0,
  },
}));

