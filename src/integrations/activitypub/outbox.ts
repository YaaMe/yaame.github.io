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
import { platform } from "../../platform";
import { AP } from "./config";
import { allPosts, href, type Post } from "../../lib/posts";

const PUBLIC = new URL("https://www.w3.org/ns/activitystreams#Public");

/** `slice(0, undefined)` is the whole array, which is what 0 means here. */
const window = () => (AP.published === 0 ? undefined : AP.published);

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
 * Posts already sent to the followers.
 *
 * Without this, every trigger would deliver the same Create again. Remote
 * servers de-duplicate by activity id and ours is stable, so the duplicates
 * would be discarded rather than shown twice — but they would still be a
 * delivery attempt per follower, every time, and a follower whose server is
 * down would collect an hour of retries for a post it already has.
 */
const DELIVERED = "ap:delivered";

/**
 * Send what has not been sent.
 *
 * Called when the outbox is built, for the same reason the actor announces
 * itself when the actor document is built: that is the moment the thing exists,
 * and it needs no timer to notice. In practice the trigger is the conformance
 * check, which fetches the outbox after every deploy.
 *
 * Only the slice the outbox publishes is considered. Delivering something the
 * outbox does not offer would leave a follower holding a post they cannot find
 * in the collection it supposedly came from.
 */
async function publishPending(ctx: Context<void>, activities: Create[]): Promise<void> {
  const recorded = await platform.get<string[]>(DELIVERED);

  // Nothing recorded means this actor has never delivered anything, which is
  // not the same as everything being new. Sixteen years of archive arriving in
  // one burst is how an account introduces itself badly, so a first run marks
  // the existing posts as sent and sends none of them. Only what is written
  // after this point is delivered.
  //
  // The opposite of the rule for the actor document, deliberately: announcing a
  // changed actor costs one message, and going quiet there would leave every
  // follower holding a stale copy.
  if (recorded === null) {
    await platform.put(DELIVERED, activities.flatMap((a) => (a.objectId ? [a.objectId.href] : [])));
    return;
  }

  const sent = new Set(recorded);
  const pending = activities.filter((a) => a.objectId && !sent.has(a.objectId.href));
  if (pending.length === 0) return;

  for (const activity of pending) {
    // Recorded before sending, like the actor digest: a delivery that fails is
    // retried by the queue, and a record written afterwards would be lost on
    // the throw — leaving the post to be delivered again on the next build.
    sent.add(activity.objectId!.href);
  }
  await platform.put(DELIVERED, [...sent]);

  for (const activity of pending) {
    await ctx.sendActivity({ identifier: AP.user }, "followers", activity);
  }
}

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

    const items = (await allPosts()).slice(0, window()).map((post) => {
      const object = note(ctx, post);
      return new Create({
        // Alongside the object it wraps, rather than on the blog: an activity is
        // this actor's, and nothing on the blog would ever answer for it.
        id: new URL("#create", object.id!),
        actor: ctx.getActorUri(identifier),
        to: PUBLIC,
        object,
      });
    });

    await publishPending(ctx, items);
    return { nextCursor: null, items };
  })
  .setCounter(async (_ctx, identifier) =>
    identifier === AP.user ? (await allPosts()).slice(0, window()).length : null,
  )
  // Paged like the other collections; see FIRST in federation.ts.
  .setFirstCursor(() => "0");

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
  // Federating, and not finished: the inbox still drops replies, boosts and
  // likes on the floor. 0.0.x says that without pretending otherwise.
  software: { name: "blogu", version: "0.0.1" },
  protocols: ["activitypub"],
  usage: {
    users: { total: 1, activeMonth: 1, activeHalfyear: 1 },
    // What the outbox actually publishes, not what the archive holds. Reporting
    // sixteen here while the outbox offers one describes two different servers.
    localPosts: (await allPosts()).slice(0, window()).length,
    // Zero, and honestly so: nothing inbound is stored yet. The inbox listens
    // for Follow, Undo and Delete, and a reply arriving here is dropped.
    localComments: 0,
  },
}));
