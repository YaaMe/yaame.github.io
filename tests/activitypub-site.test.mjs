import test from "node:test";
import assert from "node:assert/strict";
import { actorDigest, noteDigests, followLedger } from "../src/config/data.config.generated.mjs";
import { inboxHarness } from "./fixtures/inbox.mjs";

const post = (id, iso, pinned = false) => ({ id, data: {
  title: id, description: "Description", pinned,
  date: { iso, at: new Date(iso) },
} });

test("site registrations preserve reads, GET writes and their failure order", async (t) => {
  const app = await inboxHarness(t, { site: true, content: true, reload: true });
  const f = app.federation;
  const outbox = f.outboxCallbacks;
  app.installSite();
  app.installShared();
  assert.equal(f.outboxCallbacks, outbox);
  const actor = f.actorCallbacks;
  const listeners = f.inboxListeners;
  app.reinstallShared();
  app.reinstallSite();
  assert.equal(f.actorCallbacks, actor);
  assert.equal(f.inboxListeners, listeners);
  assert.equal(f.outboxCallbacks, outbox);
  assert.ok(app.inputs.some((path) => path.includes("persistence/content/posts")));
  const ctx = f.createContext(new Request("https://yaame.dev/"), undefined);
  const records = new Map();
  const events = [];
  t.mock.method(app.platform, "get", async (key) => {
    events.push(`get:${key}`);
    return structuredClone(records.get(key) ?? null);
  });
  t.mock.method(app.platform, "put", async (key, value) => {
    events.push(`put:${key}`);
    records.set(key, structuredClone(value));
  });
  const sent = [];
  let failSend = false;
  t.mock.method(ctx, "sendActivity", async (_sender, recipient, activity) => {
    events.push(`send:${activity.constructor.name}`);
    sent.push({ recipient, activity });
    if (failSend) throw new Error("send failed");
  });
  app.collections.posts.push(...Array.from({ length: 21 }, (_, i) =>
    post(`post-${i}`, `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`, i === 0)));
  app.collections.notes.push({ id: "2026", data: { notes: [
    { id: "8nicubmr", published: "2026-10-01T00:00:00Z", content: "A short **note**" },
  ] } });
  const marked = async () => (await app.database.select().from(app.deliveries)).map(({ target }) => target).sort();
  const list = (cursor = "0") => outbox.dispatcher(ctx, "yaame", cursor);

  await t.test("totals, featured and NodeInfo read without announcing", async () => {
    assert.equal(await outbox.counter(ctx, "yaame"), 22);
    assert.equal(await outbox.firstCursor(ctx, "yaame"), "0");
    assert.equal((await f.nodeInfoDispatcher(ctx)).usage.localPosts, 22);
    assert.equal((await f.nodeInfoDispatcher(ctx)).usage.localComments, 0);
    const featured = await f.featuredCallbacks.dispatcher(ctx, "yaame", null);
    assert.equal(featured.items.length, 1);
    assert.equal(featured.items[0].url.href, "https://blogu.yaame.dev/posts/post-0/");
    assert.equal(await f.featuredCallbacks.counter(ctx, "yaame"), 1);
    assert.deepEqual(sent, []);
    assert.deepEqual([...records], []);
    assert.deepEqual(await marked(), []);
  });

  await t.test("first page marks the entire window and suppresses the archive", async () => {
    const first = await list();
    assert.equal(first.items.length, 20);
    assert.equal(first.nextCursor, "20");
    assert.equal(first.items[0].id.href, "https://yaame.dev/users/yaame/notes/8nicubmr#create");
    const object = await first.items[0].getObject();
    assert.equal(object.id.href, "https://yaame.dev/users/yaame/notes/8nicubmr");
    assert.equal(object.url.href, "https://blogu.yaame.dev/notes/2026/#8nicubmr");
    assert.equal(object.content, "<p>A short <strong>note</strong></p>\n");
    assert.equal((await object.getReplies()).totalItems, 0);
    assert.equal((await object.getLikes()).totalItems, 0);
    assert.equal((await object.getShares()).totalItems, 0);
    assert.equal((await marked()).length, 22);
    assert.deepEqual(sent, []);
    assert.equal(Object.keys(records.get(noteDigests.key)).length, 22);
    const second = await list(first.nextCursor);
    assert.equal(second.items.length, 2);
    assert.equal(second.nextCursor, null);
    for (const cursor of [null, "nonsense", "-1"]) {
      assert.deepEqual((await list(cursor)).items.map((a) => a.id.href), first.items.map((a) => a.id.href));
    }
  });

  await t.test("a later page still sends new content before reconciling or writing digests", async () => {
    app.collections.posts.push(post("new-post", "2026-10-02T00:00:00Z"));
    events.length = 0;
    await list("20");
    assert.deepEqual(sent.map(({ activity }) => activity.constructor.name), ["Create"]);
    assert.equal(sent[0].activity.id.href, "https://yaame.dev/users/yaame/notes/new-post#create");
    assert.equal(sent[0].recipient, "followers");
    assert.ok(events.indexOf("send:Create") < events.indexOf(`get:${followLedger.key}`));
    assert.ok(events.indexOf(`get:${followLedger.key}`) < events.indexOf(`get:${noteDigests.key}`));
    assert.ok((await marked()).includes("new-post"));
  });

  await t.test("edits checkpoint before an awaited send and do not retry that digest", async () => {
    app.collections.posts.find((p) => p.id === "post-0").data.title = "Edited";
    events.length = 0;
    failSend = true;
    await assert.rejects(list(), /send failed/);
    assert.ok(events.indexOf(`put:${noteDigests.key}`) < events.indexOf("send:Update"));
    const update = sent.at(-1).activity;
    assert.match(update.id.href, /^https:\/\/yaame.dev\/users\/yaame\/notes\/post-0#update\/\d+$/);
    assert.match((await update.getObject()).content, /Edited/);
    const count = sent.length;
    failSend = false;
    await list();
    assert.equal(sent.length, count);
  });

  await t.test("the published window still bounds delivery until B2", async () => {
    app.AP.published = 1;
    app.collections.posts.push(post("old-unmarked", "2020-01-01T00:00:00Z"));
    const count = sent.length;
    assert.equal(await outbox.counter(ctx, "yaame"), 1);
    assert.equal((await f.nodeInfoDispatcher(ctx)).usage.localPosts, 1);
    assert.equal((await list()).items.length, 1);
    assert.equal(sent.length, count);
    assert.ok(!(await marked()).includes("old-unmarked"));
    app.AP.published = 0;
  });

  await t.test("actor keys precede its digest and digest precedes its awaited announcement", async (st) => {
    st.mock.method(ctx, "getActorKeyPairs", async () => { events.push("keys"); return []; });
    events.length = 0;
    failSend = true;
    await assert.rejects(f.actorCallbacks.dispatcher(ctx, "yaame"), /send failed/);
    assert.ok(events.indexOf("keys") < events.indexOf(`get:${actorDigest.key}`));
    assert.ok(events.indexOf(`put:${actorDigest.key}`) < events.indexOf("send:Update"));
    assert.equal(sent.at(-1).activity.id.href, `https://yaame.dev/users/yaame#update/${records.get(actorDigest.key).slice(0, 12)}`);
    failSend = false;
    const count = sent.length;
    const person = await f.actorCallbacks.dispatcher(ctx, "yaame");
    assert.equal(person.id.href, "https://yaame.dev/users/yaame");
    assert.equal(person.inboxId.href, "https://yaame.dev/users/yaame/inbox");
    assert.equal(person.outboxId.href, "https://yaame.dev/users/yaame/outbox");
    assert.equal(person.featuredId.href, "https://yaame.dev/users/yaame/featured");
    assert.equal(sent.length, count);
    assert.equal(await f.actorCallbacks.dispatcher(ctx, "other"), null);
    assert.deepEqual(await f.actorCallbacks.keyPairsDispatcher(ctx, "other"), []);
  });

  await t.test("HTTP negotiation retains browser redirects, JSON relabelling and machine responses", async () => {
    const get = (path, accept) => app.GET({ request: new Request(`https://yaame.dev${path}`, {
      headers: accept === undefined ? {} : { accept },
    }) });
    const redirect = await get("/users/yaame", "text/html");
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "https://blogu.yaame.dev/");
    for (const accept of [undefined, "*/*", "*/*;q=0.8", "application/activity+json", "text/html"]) {
      const response = await get("/users/yaame/following", accept);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), accept === "text/html" ? /^application\/json/ : /^application\/activity\+json/);
      const body = await response.json();
      assert.equal(body.totalItems, 0);
      assert.equal(body.first, "https://yaame.dev/users/yaame/following?cursor=0");
    }
    assert.equal((await get("/users/yaame/following", "application/xml")).status, 406);
    assert.equal((await get("/users/other/following?cursor=0", "application/activity+json")).status, 404);
    const discovery = await (await get("/.well-known/nodeinfo")).json();
    assert.equal(discovery.links[0].href, "https://yaame.dev/nodeinfo/2.1");
    const object = await (await get("/users/yaame/notes/8nicubmr", "application/activity+json")).json();
    assert.equal(object.id, "https://yaame.dev/users/yaame/notes/8nicubmr");
    assert.equal(object.url, "https://blogu.yaame.dev/notes/2026/#8nicubmr");
    const replies = await (await get("/users/yaame/notes/8nicubmr/replies", "application/activity+json")).json();
    assert.equal(replies.totalItems, 0);
    assert.equal(replies.first, "https://yaame.dev/users/yaame/notes/8nicubmr/replies?cursor=0");
  });
});
