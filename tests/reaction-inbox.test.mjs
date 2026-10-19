import test from "node:test";
import assert from "node:assert/strict";
import { Announce, Follow, Like, Undo } from "@fedify/fedify/vocab";
import { followers } from "../src/data.config.generated.mjs";
import { SOURCES, identityId, reactionId } from "../src/lib/interactions/key-scheme.ts";
import { inboxHarness } from "./fixtures/inbox.mjs";

const ownActor = "https://yaame.dev/users/yaame";

test("Like, Announce and Undo key reactions by signer and activity and count people by content identifier", async (t) => {
  const inbox = await inboxHarness(t);
  const friend = "https://remote.example/users/friend";
  const stranger = "https://remote.example/users/stranger";
  const post = `${ownActor}/notes/written-slug`;
  const deliver = async (activity) => {
    const dispatched = inbox.federation.inboxListeners.dispatchWithClass(activity);
    assert.ok(dispatched);
    await dispatched.listener({}, activity);
    return inbox.database.select().from(inbox.reactions);
  };
  const reaction = (Kind, { id = `https://remote.example/activities/${Kind.name.toLowerCase()}`, actor = friend, object = post } = {}) =>
    new Kind({ id: new URL(id), actor: new URL(actor), object: new URL(object) });
  const fresh = async () => {
    await inbox.database.delete(inbox.reactions);
    await inbox.database.delete(inbox.visitorIdentities);
  };

  await t.test("a redelivered Like or Announce is stored and counted once", async () => {
    await fresh();
    for (const Kind of [Like, Announce]) {
      await deliver(reaction(Kind));
      await deliver(reaction(Kind));
    }
    const rows = await deliver(reaction(Like));
    assert.equal(rows.length, 2);
    const like = rows.find((row) => row.kind === "Like");
    assert.equal(like.id, reactionId({ source: SOURCES.activitypub, identifier: friend, activityId: "https://remote.example/activities/like" }));
    assert.equal(like.authorId, identityId(SOURCES.activitypub, friend));
    assert.equal(like.objectId, post);
    assert.equal(like.target, "written-slug");
    assert.deepEqual(await inbox.reactionCounts(["written-slug", "other"]), new Map([["written-slug", { likes: 1, shares: 1 }]]));
    assert.equal((await inbox.database.select().from(inbox.visitorIdentities)).length, 1);
  });

  await t.test("the same activity id from another signer is another reaction", async () => {
    await fresh();
    await deliver(reaction(Like, { id: "https://remote.example/activities/shared" }));
    const rows = await deliver(reaction(Like, { id: "https://remote.example/activities/shared", actor: stranger }));
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].id, rows[1].id);
  });

  for (const [name, extra] of [
    ["an activity on another origin", { id: "https://elsewhere.example/activities/like" }],
    ["an activity on another port", { id: "https://remote.example:8443/activities/like" }],
    ["an activity without HTTP(S)", { id: "ftp://remote.example/activities/like" }],
    ["an object that is not ours", { object: "https://elsewhere.example/notes/1" }],
    ["a nested path under our notes", { object: `${post}/nested` }],
  ]) {
    await t.test(`${name} is refused without writing`, async () => {
      await fresh();
      assert.deepEqual(await deliver(reaction(Like, extra)), []);
      assert.deepEqual(await inbox.database.select().from(inbox.visitorIdentities), []);
    });
  }

  await t.test("Undo withdraws only its signer's reaction", async () => {
    await fresh();
    const like = reaction(Like);
    const boost = reaction(Announce);
    await deliver(like);
    await deliver(boost);
    await deliver(reaction(Like, { id: "https://remote.example/activities/stranger-like", actor: stranger }));

    let rows = await deliver(new Undo({ id: new URL("https://remote.example/activities/undo-forged"), actor: new URL(stranger), object: like }));
    assert.deepEqual(rows.filter((row) => row.undoneAt !== null), []);
    assert.deepEqual((await inbox.reactionCounts(["written-slug"])).get("written-slug"), { likes: 2, shares: 1 });

    rows = await deliver(new Undo({ id: new URL("https://remote.example/activities/undo"), actor: new URL(friend), object: like }));
    const undone = rows.filter((row) => row.undoneAt !== null).map((row) => `${row.identifier} ${row.kind}`);
    assert.deepEqual(undone, [`${friend} Like`]);
    assert.deepEqual((await inbox.reactionCounts(["written-slug"])).get("written-slug"), { likes: 1, shares: 1 });

    await deliver(like);
    assert.deepEqual((await inbox.reactionCounts(["written-slug"])).get("written-slug"), { likes: 1, shares: 1 });

    // No reaction matches, so the handler goes on to ask whether a Follow was
    // meant; that dereferences an unreachable URL. How the fetch fails depends
    // on the host's network (refused offline, DNS failure in CI), so only the
    // rejection is asserted; what matters is that nothing is withdrawn.
    await assert.rejects(deliver(new Undo({ id: new URL("https://remote.example/activities/undo-boost-forged"), actor: new URL(stranger), object: new URL(boost.id.href) })));
    rows = await inbox.database.select().from(inbox.reactions);
    assert.equal(rows.find((row) => row.kind === "Announce").undoneAt, null);
    rows = await deliver(new Undo({ id: new URL("https://remote.example/activities/undo-boost"), actor: new URL(friend), object: new URL(boost.id.href) }));
    assert.ok(rows.find((row) => row.kind === "Announce").undoneAt);
    assert.deepEqual((await inbox.reactionCounts(["written-slug"])).get("written-slug"), { likes: 1, shares: 0 });
  });

  await t.test("two Likes from one person count once, and withdrawing one leaves them counted", async () => {
    await fresh();
    const first = reaction(Like, { id: "https://remote.example/activities/like-1" });
    const second = reaction(Like, { id: "https://remote.example/activities/like-2" });
    await deliver(first);
    await deliver(second);
    assert.deepEqual((await inbox.reactionCounts(["written-slug"])).get("written-slug"), { likes: 1, shares: 0 });
    const rows = await deliver(new Undo({ id: new URL("https://remote.example/activities/undo-1"), actor: new URL(friend), object: first }));
    assert.deepEqual(rows.filter((row) => row.undoneAt !== null).map((row) => row.activityId), [first.id.href]);
    assert.deepEqual((await inbox.reactionCounts(["written-slug"])).get("written-slug"), { likes: 1, shares: 0 });
  });

  await t.test("Undo of an embedded Follow removes the follower and leaves reactions alone", async () => {
    await fresh();
    await deliver(reaction(Like));
    const follow = new Follow({ id: new URL("https://remote.example/activities/follow"), actor: new URL(friend), object: new URL(ownActor) });
    await inbox.platform.put(followers.key, [
      { id: friend, inbox: `${friend}/inbox` },
      { id: stranger, inbox: `${stranger}/inbox` },
    ]);
    const rows = await deliver(new Undo({ id: new URL("https://remote.example/activities/unfollow"), actor: new URL(friend), object: follow }));
    assert.deepEqual((await inbox.platform.get(followers.key)).map(({ id }) => id), [stranger]);
    assert.deepEqual(rows.filter((row) => row.undoneAt !== null), []);
  });
});
