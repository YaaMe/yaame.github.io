/**
 * The outbox, kept apart from federation.ts.
 *
 * It reads the posts, which means astro:content, which exists only inside an
 * Astro build. The queue consumer is a plain Worker and cannot resolve it — so
 * everything the consumer needs stays in federation.ts, and everything that
 * needs the content lives here, imported only from the Astro side.
 */
import type { Context } from "@fedify/fedify";
import { Temporal } from "@js-temporal/polyfill";
import { Create, Note, OrderedCollection, Update } from "@fedify/fedify/vocab";
import { federation, reconcileFollowing } from "./federation";
import { platform } from "../../platform";
import { replies, replyCounts } from "./store/comments";
import { counts as reactionCounts } from "./store/reactions";
import { FIRST, page } from "./paging";
import { AP } from "./config";
import { allPosts, href, type Post } from "../../lib/posts";
// Aliased: `Note` here is Fedify's protocol object, and the content entry that
// becomes one needs a different name.
import { allNotes, noteHref, noteHtml, type Note as NoteEntry } from "../../lib/notes";

const PUBLIC = new URL("https://www.w3.org/ns/activitystreams#Public");

/** `slice(0, undefined)` is the whole array, which is what 0 means here. */
const window = () => (AP.published === 0 ? undefined : AP.published);

/**
 * One item on the timeline.
 *
 * A long post becomes a note once it is rendered down to title, description and
 * link, so this is one collection rather than two.
 */
type Item = {
  slug: string;
  published: string;
  /** Already HTML. */
  content: string;
  /** Where a person reads it. */
  url: URL;
};

const fromPost = (post: Post): Item => {
  const url = new URL(href(post), AP.blogUrl);
  return {
    slug: post.id,
    published: post.data.date.iso,
    content:
      `<p><strong>${post.data.title}</strong></p>` +
      (post.data.description ? `<p>${post.data.description}</p>` : "") +
      `<p><a href="${url}">${url}</a></p>`,
    url,
  };
};

const fromNote = (n: NoteEntry): Item => ({
  slug: n.id,
  published: n.published,
  content: noteHtml(n),
  url: new URL(noteHref(n), AP.blogUrl),
});

/** Newest first, which `OrderedCollection` requires (ActivityPub §5). */
async function timeline(): Promise<Item[]> {
  const [posts, notes] = await Promise.all([allPosts(), allNotes()]);
  return [...posts.map(fromPost), ...notes.map(fromNote)].sort((a, b) =>
    b.published.localeCompare(a.published),
  );
}

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
const note = (ctx: Context<void>, item: Item, tally = { replies: 0, likes: 0, shares: 0 }) => {
  const id = ctx.getObjectUri(Note, { identifier: AP.user, slug: item.slug });
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
 * Only the slice the outbox publishes is considered: delivering something the
 * outbox does not offer leaves a follower holding a post they cannot find in
 * the collection it supposedly came from.
 *
 * Runs when the outbox is built, which after every deploy is the conformance
 * check fetching it. See
 * docs/decisions/0003-the-actor-announces-itself-when-it-is-built.md.
 */
async function publishPending(ctx: Context<void>, activities: Create[]): Promise<void> {
  const recorded = await platform.get<string[]>(DELIVERED);

  // Nothing recorded means this actor has never delivered anything, which is
  // not the same as everything being new. A first run marks the existing posts
  // as sent and sends none of them, so the archive does not arrive in one
  // burst; only what is written after that point is delivered.
  if (recorded === null) {
    await platform.put(DELIVERED, activities.flatMap((a) => (a.objectId ? [a.objectId.href] : [])));
    return;
  }

  const sent = new Set(recorded);
  const pending = activities.filter((a) => a.objectId && !sent.has(a.objectId.href));
  if (pending.length === 0) return;

  for (const activity of pending) {
    // Recorded before sending: the queue retries a failed delivery, and a
    // record written afterwards would be lost on the throw, leaving the post to
    // be delivered again on the next build.
    sent.add(activity.objectId!.href);
  }
  await platform.put(DELIVERED, [...sent]);

  for (const activity of pending) {
    await ctx.sendActivity({ identifier: AP.user }, "followers", activity);
  }
}

/** What each delivered post looked like when it was last announced. */
const DIGESTS = "ap:note-digests";

/**
 * Tell the followers when a post they already have has changed.
 *
 * Nothing re-reads a post because we edited it; a server that holds a copy goes
 * on showing what it fetched. So an edit in git is invisible to everyone who
 * received the original, forever.
 *
 * Fingerprinted on the content, deliberately not on the counts. A reply or a
 * like changes what the note serialises, and announcing those would push a
 * message to every follower's server for every heart — which is also not what
 * Mastodon does: counts travel when someone fetches, not when they change.
 *
 * Only posts that were actually delivered are announced. Editing something the
 * followers never received is not news to them.
 */
async function announceEdits(ctx: Context<void>, notes: Note[]): Promise<void> {
  const delivered = new Set((await platform.get<string[]>(DELIVERED)) ?? []);
  const digests = (await platform.get<Record<string, string>>(DIGESTS)) ?? {};

  const changed: Note[] = [];
  for (const note of notes) {
    if (!note.id) continue;
    const body = JSON.stringify([note.content?.toString(), note.url?.toString(), note.published?.toString()]);
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (digests[note.id.href] === digest) continue;
    const first = digests[note.id.href] === undefined;
    digests[note.id.href] = digest;
    // A post seen for the first time has nothing to compare against, and one
    // never delivered has no audience holding a stale copy.
    if (!first && delivered.has(note.id.href)) changed.push(note);
  }

  if (Object.keys(digests).length > 0) await platform.put(DIGESTS, digests);

  for (const note of changed) {
    await ctx.sendActivity(
      { identifier: AP.user },
      "followers",
      new Update({
        id: new URL(`#update/${Date.now()}`, note.id!),
        actor: ctx.getActorUri(AP.user),
        to: PUBLIC,
        object: note,
      }),
    );
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
  .setOutboxDispatcher(`/users/{identifier}/outbox`, async (ctx, identifier, cursor) => {
    if (identifier !== AP.user) return null;

    const items = (await timeline()).slice(0, window());
    const ids = items.map((i) => ctx.getObjectUri(Note, { identifier: AP.user, slug: i.slug }).href);
    // Two grouped queries for the page, not two per post.
    const [replyTally, reactionTally] = await Promise.all([
      replyCounts(ids),
      reactionCounts(ids),
    ]);
    const notes: Note[] = [];
    const all = items.map((item, i) => {
      const object = note(ctx, item, {
        replies: replyTally.get(ids[i]) ?? 0,
        ...(reactionTally.get(ids[i]) ?? { likes: 0, shares: 0 }),
      });
      notes.push(object);
      return new Create({
        // Alongside the object it wraps, rather than on the blog: an activity is
        // this actor's, and nothing on the blog would ever answer for it.
        id: new URL("#create", object.id!),
        actor: ctx.getActorUri(identifier),
        to: PUBLIC,
        object,
      });
    });

    // Delivery considers the whole published window, not the page in hand: a
    // reader asking for page three must not decide which posts the followers
    // have been sent.
    await publishPending(ctx, all);
    // Reconciled at the same moment as delivery: a change of intent can only
    // arrive by deploy, and the check fetches this after every one.
    await reconcileFollowing(ctx);
    await announceEdits(ctx, notes);
    return page(all, cursor);
  })
  .setCounter(async (_ctx, identifier) =>
    identifier === AP.user ? (await timeline()).slice(0, window()).length : null,
  )
  .setFirstCursor(FIRST);

/**
 * Pinned posts — the only content a stranger sees without following and without
 * waiting for the next publish.
 *
 * Long posts only: a note has no title, and what pinning is for is telling a
 * first-time visitor what is written here.
 */
federation.setFeaturedDispatcher(`/users/{identifier}/featured`, async (ctx, identifier) => {
  if (identifier !== AP.user) return null;
  const pinned = (await allPosts()).filter((p) => p.data.pinned).map(fromPost);
  const ids = pinned.map((i) => ctx.getObjectUri(Note, { identifier, slug: i.slug }).href);
  const [replyTally, reactionTally] = await Promise.all([replyCounts(ids), reactionCounts(ids)]);
  return {
    items: pinned.map((item, i) =>
      note(ctx, item, {
        replies: replyTally.get(ids[i]) ?? 0,
        ...(reactionTally.get(ids[i]) ?? { likes: 0, shares: 0 }),
      }),
    ),
    nextCursor: null,
  };
}).setCounter(async (_ctx, identifier) =>
  identifier === AP.user ? (await allPosts()).filter((p) => p.data.pinned).length : null,
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
    const item = (await timeline()).find((i) => i.slug === slug);
    if (!item) return null;
    const id = ctx.getObjectUri(Note, { identifier, slug }).href;
    const [replyTally, reactionTally] = await Promise.all([
      replyCounts([id]),
      reactionCounts([id]),
    ]);
    return note(ctx, item, {
      replies: replyTally.get(id) ?? 0,
      ...(reactionTally.get(id) ?? { likes: 0, shares: 0 }),
    });
  },
);

/**
 * The replies under one post.
 *
 * Items are the reply objects' own ids. They live on the servers that wrote
 * them, and re-serving their content here would make us a second, diverging
 * copy of someone else's words.
 */
federation.setOrderedCollectionDispatcher(
  "replies",
  Note,
  `/users/{identifier}/notes/{slug}/replies`,
  async (ctx, { identifier, slug }, cursor) => {
    if (identifier !== AP.user) return null;
    const id = ctx.getObjectUri(Note, { identifier, slug }).href;
    return page(
      (await replies(id)).map((c) => new Note({ id: new URL(c.objectId) })),
      cursor,
    );
  },
).setFirstCursor(FIRST).setCounter(async (ctx, { identifier, slug }) => {
  if (identifier !== AP.user) return null;
  const id = ctx.getObjectUri(Note, { identifier, slug }).href;
  return (await replyCounts([id])).get(id) ?? 0;
});

/**
 * NodeInfo.
 *
 * Lives here, not in federation.ts, so the reported counts sit beside the
 * timeline and window that determine them — moving it apart lets the two drift
 * with nothing comparing them. Unregistering it leaves
 * /.well-known/nodeinfo advertising a link whose route answers 404.
 * See docs/decisions/0002.
 */
federation.setNodeInfoDispatcher("/nodeinfo/2.1", async () => ({
  software: { name: "blogu", version: "0.0.1" },
  protocols: ["activitypub"],
  usage: {
    users: { total: 1, activeMonth: 1, activeHalfyear: 1 },
    // What the outbox actually publishes, not what the archive holds. Reporting
    // sixteen here while the outbox offers one describes two different servers.
    localPosts: (await timeline()).slice(0, window()).length,
    // Zero because the field counts comments written by users registered
    // here, and the one account here writes posts rather than comments. Every
    // row in the comments table was written by someone on another server, and
    // counting those would report another server's users as ours.
    localComments: 0,
  },
}));
