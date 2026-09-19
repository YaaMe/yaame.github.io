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
import { allNotes } from "../../lib/notes";
import { marked } from "marked";

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
/**
 * 一条时间线上的一项。
 *
 * 长文经过转译(标题 + 摘要 + 链接)之后就是一条短文 —— outbox 不是两个集合,
 * 是一条时间线。所以这里只有一种结构,长文和短文都先变成它。
 */
type Item = {
  slug: string;
  published: string;
  /** 已经是 HTML。长文是拼出来的,短文是 markdown 渲染出来的。 */
  content: string;
  /** 人能看的地址。短文还没有页面 —— 絮语那一页做出来之前不假装有。 */
  url?: URL;
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

const fromNote = (n: { id: string; published: string; content: string }): Item => ({
  slug: n.id,
  published: n.published,
  // marked 而不是原样输出：短文里最常见的就是链接，不解析就只能显示裸 URL。
  content: marked.parse(n.content, { async: false }) as string,
});

/** 两种合成一条,新的在前 —— `OrderedCollection` 必须倒序(AP §5)。 */
async function timeline(): Promise<Item[]> {
  const [posts, notes] = await Promise.all([allPosts(), allNotes()]);
  return [...posts.map(fromPost), ...notes.map(fromNote)].sort((a, b) =>
    b.published.localeCompare(a.published),
  );
}

const note = (ctx: Context<void>, item: Item, tally = { replies: 0, likes: 0, shares: 0 }) => {
  const id = ctx.getObjectUri(Note, { identifier: AP.user, slug: item.slug });
  return new Note({
    id,
    attribution: ctx.getActorUri(AP.user),
    ...(item.url ? { url: item.url } : {}),
    to: PUBLIC,
    // Public posts are addressed to the followers as well, which is how every
    // other implementation spells "public, and my followers should see it".
    cc: ctx.getFollowersUri(AP.user),
    // Without this a reader has no date to sort by, and a receiving server
    // supplies one of its own — so the same post is dated differently on every
    // instance that holds it.
    // Two Temporals, one runtime. Fedify's signature names an ambient global
    // that does not exist in either runtime we deploy to — it rejects a string
    // and requires a real Instant — while the polyfill it bundles produces one
    // that works. The assertion is where those two identities are reconciled;
    // measured, not assumed: a string throws, this does not.
    published: Temporal.Instant.from(item.published) as unknown as ConstructorParameters<
      typeof Note
    >[0]["published"],
    // The conversation under the post, which until now existed only in our
    // database: replies arrived, were stored, and nothing said so. A reference
    // rather than the items, with the count inline — that is what a reader uses
    // to decide whether the collection is worth fetching.
    // OrderedCollection, matching what the endpoint actually serves. A reference
    // that names a different type than the resource behind it is the kind of
    // disagreement only a strict client notices, and only in production.
    replies: new OrderedCollection({
      id: new URL(`${id.href}/replies`),
      totalItems: tally.replies,
    }),
    // Counts, with no id — there is no endpoint behind them and a link to one
    // that does not exist is the defect this whole pass was about. The spec
    // makes both collections a MAY and only obliges a server to add to them
    // "if this collection is present"; Mastodon publishes the same counts and
    // answers 404 for the collections themselves, which is the shape a reader
    // already expects.
    //
    // Who liked or boosted a post stays unpublished. That is a decision, not an
    // omission: the members are held in the database either way.
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
    // 和投递同一个时刻对账：这是每次部署之后一致性检查必然命中的地方，而关注
    // 意图的变化也只可能来自一次部署。
    await reconcileFollowing(ctx);
    await announceEdits(ctx, notes);
    return page(all, cursor);
  })
  .setCounter(async (_ctx, identifier) =>
    identifier === AP.user ? (await timeline()).slice(0, window()).length : null,
  )
  .setFirstCursor(FIRST);

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
 * The other half of the `replies` reference above: the count says how many, and
 * this is where they are. Items are the reply objects' own ids — they live on
 * the servers that wrote them, and re-serving their content here would make us
 * a second, diverging copy of someone else's words.
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
    localPosts: (await timeline()).slice(0, window()).length,
    // Zero, and honestly so: nothing inbound is stored yet. The inbox listens
    // for Follow, Undo and Delete, and a reply arriving here is dropped.
    localComments: 0,
  },
}));
