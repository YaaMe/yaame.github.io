/**
 * The outbox, kept apart from federation.ts.
 *
 * It reads the posts, which means astro:content, which exists only inside an
 * Astro build. The queue consumer is a plain Worker and cannot resolve it — so
 * everything the consumer needs stays in federation.ts, and everything that
 * needs the content lives here, imported only from the Astro side.
 */
import type { Context } from "@fedify/fedify";
import { Create, Note } from "@fedify/fedify/vocab";
import { federation } from "./federation";
import { AP } from "./config";
import { allPosts, href, type Post } from "../../lib/posts";

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
 * One post, as an ActivityPub object.
 *
 * Built in one place because two of them need it: the outbox inlines it, and
 * the object dispatcher answers with it when a remote server fetches the id.
 * Two constructions would be two definitions, and the drift between them would
 * show up as a remote copy that disagrees with ours about our own post.
 *
 * The id and the url are deliberately different addresses. The id is this
 * actor's object and lives with the actor; the url is the page a person reads,
 * and lives on the blog. They were the same address until now, which asked one
 * URL to be two resources — and the blog cannot answer as both: its pages are
 * static assets served ahead of the Worker, so a request for
 * application/activity+json gets HTML no matter what it asked for. Splitting
 * them costs nothing and leaves the blog's hot paths as plain files.
 */
const note = (ctx: Context<void>, post: Post) => {
  const url = new URL(href(post), AP.blogUrl);
  return new Note({
    id: ctx.getObjectUri(Note, { identifier: AP.user, slug: post.id }),
    attribution: ctx.getActorUri(AP.user),
    url,
    to: PUBLIC,
    content:
      `<p><strong>${post.data.title}</strong></p>` +
      (post.data.description ? `<p>${post.data.description}</p>` : "") +
      `<p><a href="${url}">${url}</a></p>`,
  });
};

/**
 * The outbox is derived from the posts, not accumulated in storage.
 *
 * The content lives in git, so the activity history is a projection of it: the
 * same commits produce the same outbox, and there is no second copy to drift.
 * Only what arrives from outside — followers, and later replies — needs to be
 * stored.
 */
federation
  .setOutboxDispatcher(`/users/{identifier}/outbox`, async (ctx, identifier) => {
    if (identifier !== AP.user) return null;

    return {
      items: (await allPosts()).slice(0, PUBLISHED).map((post) => {
        const object = note(ctx, post);
        return new Create({
          // Alongside the object it wraps, rather than on the blog: an activity
          // is this actor's, and nothing on the blog would ever answer for it.
          id: new URL("#create", object.id!),
          actor: ctx.getActorUri(identifier),
          to: PUBLIC,
          object,
        });
      }),
    };
  })
  .setCounter(async (_ctx, identifier) =>
    identifier === AP.user ? Math.min((await allPosts()).length, PUBLISHED) : null,
  );

/**
 * The object behind a Note's id.
 *
 * Without this the id in every Create points at nothing that can be fetched as
 * ActivityPub. A remote server that inlines what it is given never notices; one
 * that re-fetches to verify, or to resolve a reply, gets a 404 — and the
 * failure belongs to the post, not to the request that surfaced it.
 *
 * The slug is the post's own id, so the address is stable across builds for as
 * long as the file keeps its name.
 */
federation.setObjectDispatcher(
  Note,
  `/users/{identifier}/notes/{slug}`,
  async (ctx, { identifier, slug }) => {
    if (identifier !== AP.user) return null;
    const post = (await allPosts()).find((p) => p.id === slug);
    return post ? note(ctx, post) : null;
  },
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
    // What the outbox actually publishes, not what the archive holds. Reporting
    // sixteen here while the outbox offers one describes two different servers.
    localPosts: Math.min((await allPosts()).length, PUBLISHED),
    // Zero, and honestly so: nothing inbound is stored yet. The inbox listens
    // for Follow, Undo and Delete, and a reply arriving here is dropped.
    localComments: 0,
  },
}));
