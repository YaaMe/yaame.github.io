import test from "node:test";
import assert from "node:assert/strict";
import { Accept, Delete, Follow, Person, Reject } from "@fedify/fedify/vocab";
import { following, followLedger } from "../src/config/data.config.generated.mjs";
import { inboxHarness } from "./fixtures/inbox.mjs";

test("consumer registrations preserve following intent, order and late replies without content", async (t) => {
  const app = await inboxHarness(t, { consumer: true, reload: true });
  assert.ok(app.inputs.includes("worker/consumer.ts"));
  assert.ok(!app.inputs.some((path) => /persistence\/content|selectors\/(posts|notes)|astro\.binding|routes\/activitypub\/site/.test(path)));
  const f = app.federation;
  const callbacks = f.followingCallbacks;
  app.installShared();
  app.reinstallShared();
  assert.equal(f.followingCallbacks, callbacks);
  assert.equal(f.outboxCallbacks, undefined);
  assert.equal(f.nodeInfoDispatcher, undefined);
  await assert.rejects(app.consumer.queue({ messages: [] }), /without a queue binding/);
  const ctx = f.createContext(new Request("https://yaame.dev/"), undefined);
  const own = ctx.getActorUri("yaame");
  const friend = "https://remote.example/users/friend";
  const other = "https://remote.example/users/other";
  const reply = (Type, actor = friend, followActor = own.href, target = friend) => new Type({
    actor: new URL(actor),
    object: new Follow({ actor: new URL(followActor), object: target ? new URL(target) : null }),
  });
  const receive = (activity) => f.inboxListeners.dispatchWithClass(activity).listener(ctx, activity);
  const read = async () => (await app.platform.get(following.key)) ?? [];

  await app.platform.put(followLedger.key, { "@friend@remote.example": friend });
  await app.platform.put(following.key, [other]);
  for (const invalid of [reply(Accept, friend, other), reply(Accept, friend, own.href, other)]) {
    await receive(invalid);
    assert.deepEqual(await read(), [other]);
  }
  await receive(reply(Accept));
  assert.deepEqual(await read(), [friend, other]);
  await receive(reply(Accept));
  assert.deepEqual(await read(), [friend, other]);

  const events = [];
  t.mock.method(ctx, "lookupObject", async (id) => {
    events.push(["lookup", id]);
    return new Person({ id: new URL(id), inbox: new URL(`${id}/inbox`) });
  });
  t.mock.method(ctx, "sendActivity", async (_sender, _recipient, activity) => {
    events.push([activity.constructor.name, activity.id.href]);
    assert.equal((await activity.getObject()).id.href, `${own.href}#follow/%40friend%40remote.example`);
    assert.deepEqual(await read(), [friend, other]);
    assert.deepEqual(await app.platform.get(followLedger.key), { "@friend@remote.example": friend });
  });
  await app.reconcileFollowing(ctx);
  assert.deepEqual(events, [
    ["lookup", friend],
    ["Undo", `${own.href}#unfollow/%40friend%40remote.example`],
  ]);
  assert.deepEqual(await read(), [other]);
  assert.deepEqual(await app.platform.get(followLedger.key), {});
  await receive(reply(Accept));
  assert.deepEqual(await read(), [other]);

  await app.platform.put(following.key, [friend, other, friend]);
  await receive(reply(Reject, friend, other));
  assert.deepEqual(await read(), [friend, other, friend]);
  await receive(reply(Reject));
  assert.deepEqual(await read(), [other]);
  await app.platform.put(following.key, [friend, other, friend]);
  await receive(new Delete({ actor: new URL(friend), object: new URL(friend) }));
  assert.deepEqual(await read(), [other]);

  const members = Array.from({ length: 22 }, (_, i) => `https://remote.example/users/${i}`);
  await app.platform.put(following.key, members);
  assert.equal(await callbacks.counter(ctx, "yaame"), 22);
  assert.equal(await callbacks.firstCursor(ctx, "yaame"), "0");
  for (const cursor of [null, "bad", "-2", "0", "Infinity"]) {
    const page = await callbacks.dispatcher(ctx, "yaame", cursor);
    assert.deepEqual(page.items.map(String), members.slice(0, 20));
    assert.equal(page.nextCursor, "20");
  }
  assert.deepEqual((await callbacks.dispatcher(ctx, "yaame", "20suffix")).items.map(String), members.slice(20));
  assert.deepEqual(await callbacks.dispatcher(ctx, "yaame", "40"), { items: [], nextCursor: null });
  assert.equal(await callbacks.dispatcher(ctx, "other", "0"), null);
});
