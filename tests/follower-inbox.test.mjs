/**
 * Regression for #75, through the real inbox listeners: Follow, Undo and the
 * account Delete each change only their signer's follower row, and the
 * collection and fan-out read the table.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Delete, Endpoints, Follow, Person, Undo } from "@fedify/fedify/vocab";
import { SOURCES, identityId } from "../src/models/interactions/key-scheme.ts";
import { inboxHarness } from "./fixtures/inbox.mjs";

const ownActor = "https://yaame.dev/users/yaame";
const actorOf = (name) => `https://remote.example/users/${name}`;

// Where Fedify would fetch the sender's actor document, this answers from a
// fixed table; anything else is a test that reached the network.
function actorLoader(documents) {
  return async (url) => {
    const document = documents.get(url);
    if (!document) throw new Error(`unexpected fetch: ${url}`);
    return { contextUrl: null, document, documentUrl: url };
  };
}

async function actorDocument(actor, inbox = `${actor}/inbox`) {
  return new Person({
    id: new URL(actor),
    inbox: new URL(inbox),
    endpoints: new Endpoints({ sharedInbox: new URL("https://remote.example/inbox") }),
  }).toJsonLd();
}

test("Follow, Undo and Delete keep one follower row per actor", async (t) => {
  const inbox = await inboxHarness(t);
  const sent = [];
  const context = {
    getActorUri: (identifier) => new URL(`https://yaame.dev/users/${identifier}`),
    sendActivity: async (_sender, recipient, activity) => {
      sent.push({ to: recipient.id?.href, type: activity.constructor.name, follow: activity.objectId?.href });
    },
  };
  const deliver = async (activity) => {
    const dispatched = inbox.federation.inboxListeners.dispatchWithClass(activity);
    assert.ok(dispatched);
    await dispatched.listener(context, activity);
  };
  const documents = new Map();
  const follow = async (name, { id = `https://remote.example/follows/${name}`, inbox: address } = {}) => {
    documents.set(actorOf(name), await actorDocument(actorOf(name), address));
    return new Follow(
      { id: new URL(id), actor: new URL(actorOf(name)), object: new URL(ownActor) },
      { documentLoader: actorLoader(documents) },
    );
  };
  const stored = async () => (await inbox.database.select().from(inbox.followers))
    .map(({ identifier, inbox: address }) => [identifier, address]).sort();
  const fresh = async () => {
    sent.length = 0;
    await inbox.database.delete(inbox.followers);
    await inbox.database.delete(inbox.visitorIdentities);
  };

  await t.test("two Follows delivered together are both kept and both accepted", async () => {
    await fresh();
    await Promise.all([deliver(await follow("one")), deliver(await follow("two"))]);
    assert.deepEqual(await stored(), [[actorOf("one"), `${actorOf("one")}/inbox`], [actorOf("two"), `${actorOf("two")}/inbox`]]);
    assert.deepEqual(sent.map(({ to, type }) => [to, type]).sort(), [[actorOf("one"), "Accept"], [actorOf("two"), "Accept"]]);
    const [row] = await inbox.database.select().from(inbox.followers).limit(1);
    assert.equal(row.source, SOURCES.activitypub);
    assert.equal(row.id, identityId(SOURCES.activitypub, row.identifier));
  });

  await t.test("a repeated Follow moves the inbox and keeps one row", async () => {
    await fresh();
    await deliver(await follow("mover"));
    await deliver(await follow("mover", { id: "https://remote.example/follows/mover-2", inbox: `${actorOf("mover")}/moved` }));
    assert.deepEqual(await stored(), [[actorOf("mover"), `${actorOf("mover")}/moved`]]);
    assert.equal(sent.length, 2);
  });

  await t.test("a Follow of another actor is neither stored nor accepted", async () => {
    await fresh();
    documents.set(actorOf("lost"), await actorDocument(actorOf("lost")));
    await deliver(new Follow(
      { id: new URL("https://remote.example/follows/lost"), actor: new URL(actorOf("lost")), object: new URL("https://elsewhere.example/users/other") },
      { documentLoader: actorLoader(documents) },
    ));
    assert.deepEqual(await stored(), []);
    assert.deepEqual(sent, []);
  });

  await t.test("a Follow whose actor document names someone other than the signer is refused", async () => {
    await fresh();
    documents.set(actorOf("impostor"), await actorDocument(actorOf("victim"), `${actorOf("impostor")}/inbox`));
    await deliver(new Follow(
      { id: new URL("https://remote.example/follows/impostor"), actor: new URL(actorOf("impostor")), object: new URL(ownActor) },
      { documentLoader: actorLoader(documents) },
    ));
    assert.deepEqual(await stored(), []);
    assert.deepEqual(sent, []);
  });

  await t.test("the row is keyed by the signer the Follow names", async () => {
    await fresh();
    await deliver(await follow("signer"));
    const [row] = await inbox.database.select().from(inbox.followers);
    assert.equal(row.identifier, actorOf("signer"));
    assert.equal(row.id, identityId(SOURCES.activitypub, actorOf("signer")));
  });

  await t.test("an Undo removes only its signer's row, whoever the embedded Follow names", async () => {
    await fresh();
    for (const name of ["leaving", "staying"]) await deliver(await follow(name));
    const forged = new Follow({ id: new URL("https://remote.example/follows/staying"), actor: new URL(actorOf("staying")), object: new URL(ownActor) });
    await deliver(new Undo({ id: new URL("https://remote.example/undo/1"), actor: new URL(actorOf("leaving")), object: forged }));
    assert.deepEqual(await stored(), [[actorOf("staying"), `${actorOf("staying")}/inbox`]]);
  });

  await t.test("an account Delete removes that account's row only", async () => {
    await fresh();
    for (const name of ["deleted", "staying"]) await deliver(await follow(name));
    await deliver(new Delete({ id: new URL("https://remote.example/delete/1"), actor: new URL(actorOf("deleted")), object: new URL(actorOf("deleted")) }));
    assert.deepEqual(await stored(), [[actorOf("staying"), `${actorOf("staying")}/inbox`]]);
  });

  await t.test("a written-off inbox drops its follower", async () => {
    await fresh();
    for (const name of ["dead", "staying"]) await deliver(await follow(name));
    assert.deepEqual(await inbox.dropFollowersAt(`${actorOf("dead")}/inbox`, [actorOf("staying")]), []);
    assert.deepEqual(await inbox.dropFollowersAt(`${actorOf("dead")}/inbox`, [actorOf("dead")]), [actorOf("dead")]);
    assert.deepEqual(await inbox.dropFollowersAt("https://remote.example/inbox", [actorOf("staying")]), []);
    assert.deepEqual(await stored(), [[actorOf("staying"), `${actorOf("staying")}/inbox`]]);
  });

  await t.test("fan-out and the collection read every federated follower and no other source", async () => {
    await fresh();
    await inbox.database.insert(inbox.visitorIdentities).values({ id: identityId(SOURCES.github, "123"), source: SOURCES.github, identifier: "123", name: null });
    await inbox.database.insert(inbox.followers).values({
      id: identityId(SOURCES.github, "123"), source: SOURCES.github, identifier: "123",
      inbox: null, sharedInbox: null, followId: null, followedAt: "2026-10-19T00:00:00Z",
    });
    const names = Array.from({ length: 21 }, (_, index) => `many-${String(index).padStart(2, "0")}`);
    for (const name of names) await deliver(await follow(name));
    const callbacks = inbox.federation.followersCallbacks;
    const everyone = await callbacks.dispatcher(context, "yaame", null);
    assert.deepEqual(everyone.items.map(({ id }) => id.href).sort(), names.map(actorOf));
    assert.equal(everyone.nextCursor, null);
    const first = await callbacks.dispatcher(context, "yaame", "0");
    const second = await callbacks.dispatcher(context, "yaame", first.nextCursor);
    assert.equal(first.items.length, 20);
    assert.deepEqual([...first.items, ...second.items].map(({ id }) => id.href), everyone.items.map(({ id }) => id.href));
    assert.equal(second.nextCursor, null);
    assert.equal(await callbacks.counter(context, "yaame"), 21);
    assert.equal(everyone.items[0].endpoints.sharedInbox.href, "https://remote.example/inbox");
  });
});
