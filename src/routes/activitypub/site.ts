import { Note } from "@fedify/fedify/vocab";
import { federation, registerOnce } from "../../services/activitypub/runtime.ts";
import { publishOutbox } from "../../services/activitypub/publish.ts";
import { timeline, publishedItems, pinnedItems, pinnedCount } from "../../selectors/activitypub/outbox.ts";
import { interactionCounts } from "../../selectors/interactions/counts.ts";
import { replies, replyCounts } from "../../selectors/interactions/comments.ts";
import { OBJECT_PATH_TEMPLATE, note } from "../../selectors/activitypub/objects.ts";
import { FIRST, PAGE_SIZE, parseCursor } from "../../params/activitypub-paging.ts";
import { page } from "../../lib/page.ts";
import { collectionPage, replyObjects, nodeInfo } from "../../schemas/activitypub.ts";
import { installShared } from "./shared.ts";
import { isLocalActor } from "./actor.ts";

export function installSite(): void {
  installShared();
  registerOnce("site", registerSite);
}

function registerSite(): void {
  // Git is the content authority; the outbox has no separately stored history.
  federation.setOutboxDispatcher("/users/{identifier}/outbox", async (ctx, identifier, cursor) => {
    if (!isLocalActor(identifier)) return null;
    const items = await publishedItems();
    const tally = await interactionCounts(items.map((item) => item.slug));
    const all = await publishOutbox(ctx, items, tally);
    return collectionPage(page(all, parseCursor(cursor), PAGE_SIZE));
  }).setCounter(async (_ctx, identifier) =>
    isLocalActor(identifier) ? (await publishedItems()).length : null,
  ).setFirstCursor(FIRST);

  // Only titled posts are pinned: they tell a first-time visitor what is here.
  federation.setFeaturedDispatcher("/users/{identifier}/featured", async (ctx, identifier) => {
    if (!isLocalActor(identifier)) return null;
    const pinned = await pinnedItems();
    const tally = await interactionCounts(pinned.map((item) => item.slug));
    return { items: pinned.map((item) => note(ctx, item, tally.get(item.slug))), nextCursor: null };
  }).setCounter(async (_ctx, identifier) => isLocalActor(identifier) ? await pinnedCount() : null);

  // A receiver may re-fetch an id to verify it or resolve a reply. Every
  // published id must answer independently of the outbox window.
  federation.setObjectDispatcher(Note, OBJECT_PATH_TEMPLATE, async (ctx, { identifier, slug }) => {
    if (!isLocalActor(identifier)) return null;
    const item = (await timeline()).find((i) => i.slug === slug);
    if (!item) return null;
    return note(ctx, item, (await interactionCounts([slug])).get(slug));
  });

  // Reply ids belong to their remote authors; re-serving their content here
  // would create another copy of their words.
  federation.setOrderedCollectionDispatcher("replies", Note, `${OBJECT_PATH_TEMPLATE}/replies`,
    async (_ctx, { identifier, slug }, cursor) => {
      if (!isLocalActor(identifier)) return null;
      return collectionPage(page(replyObjects(await replies(slug)), parseCursor(cursor), PAGE_SIZE));
    },
  ).setFirstCursor(FIRST).setCounter(async (_ctx, { identifier, slug }) => {
    if (!isLocalActor(identifier)) return null;
    return (await replyCounts([slug])).get(slug) ?? 0;
  });

  // NodeInfo must count the same published window the outbox offers. Removing
  // registration leaves discovery advertising an endpoint that answers 404.
  federation.setNodeInfoDispatcher("/nodeinfo/2.1", async () => nodeInfo((await publishedItems()).length));
}
