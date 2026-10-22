import test from "node:test";
import assert from "node:assert/strict";
import { Create, Delete, Note } from "@fedify/fedify/vocab";
import {
  handleFollow,
  handleUndoFollow,
} from "../src/services/activitypub/inbox-follow.ts";
import { visibleComments } from "../src/selectors/interactions/comment-view.ts";
import { storedComment } from "./fixtures/interactions.mjs";
import { SOURCES, commentId, identityId } from "../src/models/interactions/key-scheme.ts";
import { inboxHarness } from "./fixtures/inbox.mjs";

const ownActor = "https://yaame.dev/users/yaame";
const firstFollower = {
  actorUrl: "https://remote.example/users/one",
  inbox: "https://remote.example/users/one/inbox",
  sharedInbox: null,
  followId: "https://remote.example/activities/follow-1",
};

test("Create comments keep HTTP(S) identifiers and the signed actor", async (t) => {
  const inbox = await inboxHarness(t);
  const friend = "https://remote.example/users/friend";
  const root = `${ownActor}/notes/example`;
  const createComment = (extra = {}) => {
    const fields = {
      activityId: "https://remote.example/activities/comment",
      objectId: "https://remote.example/notes/comment",
      replyToId: root,
      actorId: friend,
      attributionId: friend,
      ...extra,
    };
    return new Create({
      id: new URL(fields.activityId),
      actor: fields.actorId === null ? null : new URL(fields.actorId),
      object: new Note({
        id: new URL(fields.objectId),
        replyTarget: new URL(fields.replyToId),
        attribution: fields.attributionId === null ? null : new URL(fields.attributionId),
        content: "A reply",
      }),
    });
  };

  await t.test("a matching attribution is stored", async () => {
    const rows = await inbox.receive(createComment());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identifier, friend);
    assert.equal(rows[0].id, commentId({ source: SOURCES.activitypub, identifier: friend, objectId: rows[0].objectId }));
    assert.equal(rows[0].authorId, identityId(SOURCES.activitypub, friend));
    assert.equal(rows[0].root, "example");
    assert.equal(rows[0].replyTo, null);
    assert.equal(rows[0].inReplyTo, root);
  });

  await t.test("an absent attribution uses the signed actor", async () => {
    const rows = await inbox.receive(createComment({ attributionId: null }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identifier, friend);
  });

  for (const attributionId of [
    "https://remote.example/users/other",
    "https://mastodon.social/users/other",
  ]) {
    await t.test("a different attribution is refused", async () => {
      assert.deepEqual(await inbox.receive(createComment({ attributionId })), []);
    });
  }

  await t.test("every attribution must match the signed actor", async () => {
    const activity = createComment();
    const note = await activity.getObject();
    const object = note.clone({ attributions: [
      new URL(friend),
      new URL("https://mastodon.social/users/other"),
    ] });
    assert.deepEqual(await inbox.receive(activity.clone({ object })), []);
  });

  await t.test("the signed actor is required", async () => {
    assert.deepEqual(await inbox.receive(createComment({ actorId: null })), []);
  });

  for (const field of ["activityId", "objectId", "actorId", "attributionId"]) {
    await t.test(`${field} requires HTTP(S)`, async () => {
      const extra = { [field]: "ftp://example.test/reference" };
      if (field === "actorId") extra.attributionId = extra.actorId;
      assert.deepEqual(await inbox.receive(createComment(extra)), []);
    });
  }

  await t.test("HTTP identifiers are also stored", async () => {
    const rows = await inbox.receive(createComment({
      activityId: "http://remote.example/activities/comment",
      objectId: "http://remote.example/notes/comment",
      actorId: "http://remote.example/users/friend",
      attributionId: "http://remote.example/users/friend",
    }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identifier, "http://remote.example/users/friend");
  });

  for (const replyToId of ["ftp://example.test/reference", "https://elsewhere.example/not-stored", `${root}/nested`, `${root}?query`, `${root}#fragment`]) {
    await t.test(`unknown or malformed parent is refused: ${replyToId}`, async () => {
      assert.deepEqual(await inbox.receive(createComment({ replyToId })), []);
    });
  }

  for (const field of ["activityId", "objectId"]) {
    await t.test(`${field} must share the signing actor's origin`, async () => {
      for (const value of ["https://elsewhere.example/reference", "http://remote.example/reference", "https://remote.example:8443/reference"]) {
        assert.deepEqual(await inbox.receive(createComment({ [field]: value })), []);
      }
    });
  }

  await t.test("record refuses invalid input without throwing or writing", async () => {
    await inbox.database.delete(inbox.comments);
    await inbox.database.delete(inbox.visitorIdentities);
    const reply = {
      activityId: "https://remote.example/activities/comment",
      objectId: "https://remote.example/notes/comment",
      inReplyTo: root,
      actorId: friend,
      content: "A reply",
      published: "2026-10-10T00:00:00Z",
    };
    for (const field of ["activityId", "objectId", "inReplyTo", "actorId"]) {
      for (const value of ["not a URL", "ftp://remote.example/reference"]) {
        assert.equal(await inbox.record({ ...reply, [field]: value }, () => "example"), false, field);
      }
    }
    assert.equal(await inbox.record(reply, () => "bad/root"), false);
    assert.deepEqual(await inbox.database.select().from(inbox.comments), []);
    assert.deepEqual(await inbox.database.select().from(inbox.visitorIdentities), []);
  });

  await t.test("an HTTP(S) reply target keeps its stored root", async () => {
    const parent = storedComment("parent", {
      activityId: "https://remote.example/activities/parent",
      objectId: "https://remote.example/notes/parent",
      root: "example",
      identifier: friend,
      content: "Parent",
      published: "2026-10-10T00:00:00Z",
      receivedAt: "2026-10-10T00:00:00Z",
    });
    const rows = await inbox.receive(createComment({ replyToId: parent.objectId }), [parent]);
    const reply = rows.find(({ objectId }) => objectId !== parent.objectId);
    assert.equal(rows.length, 2);
    assert.equal(reply.replyTo, parent.id);
    assert.equal(reply.root, "example");
    assert.equal(reply.inReplyTo, parent.objectId);
  });

  await t.test("redelivery inserts once and another signer has a separate id", async () => {
    await inbox.database.delete(inbox.comments);
    const activity = createComment();
    const listener = inbox.federation.inboxListeners.dispatchWithClass(activity).listener;
    await listener({}, activity);
    await listener({}, activity);
    const other = createComment({ actorId: "https://remote.example/users/other", attributionId: "https://remote.example/users/other" });
    await listener({}, other);
    const rows = await inbox.database.select().from(inbox.comments);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].id, rows[1].id);
  });

  await t.test("the same Note in two Creates with different activity ids is stored once", async () => {
    const [first] = await inbox.receive(createComment());
    const rewrapped = createComment({ activityId: "https://remote.example/activities/rewrapped" });
    await inbox.federation.inboxListeners.dispatchWithClass(rewrapped).listener({}, rewrapped);
    assert.deepEqual(await inbox.database.select().from(inbox.comments), [first]);
  });

  await t.test("Delete clears stored text only for the matching object and signing author", async () => {
    const [comment] = await inbox.receive(createComment());
    assert.equal(comment.content, "A reply");
    const receiveDelete = async (actor, object) => {
      const activity = new Delete({ actor: new URL(actor), object: new URL(object) });
      await inbox.federation.inboxListeners.dispatchWithClass(activity).listener({}, activity);
      return (await inbox.database.select().from(inbox.comments))[0];
    };
    assert.deepEqual(await receiveDelete("https://remote.example/users/other", comment.objectId), comment);
    assert.deepEqual(await receiveDelete(friend, comment.activityId), comment);
    const deleted = await receiveDelete(friend, comment.objectId);
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.content, "");
    assert.equal(deleted.identifier, friend);
    assert.equal(deleted.id, comment.id);
    assert.deepEqual(visibleComments([deleted]), []);
  });

  await t.test("Delete matches the computed Note id after URL normalization", async () => {
    const rawObjectId = "https://REMOTE.example:443/notes/comment";
    const comment = storedComment("normalized-delete", {
      identifier: friend,
      activityId: "https://remote.example/activities/comment",
      objectId: rawObjectId,
    });
    const activity = new Delete({ actor: new URL(friend), object: new URL(rawObjectId) });
    const [deleted] = await inbox.receive(activity, [comment]);
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.content, "");
    assert.equal(deleted.objectId, rawObjectId);
    assert.equal(deleted.id, comment.id);
  });

  await t.test("reply readers use content identifiers, return federated object URLs and key withdrawals by internal id", async () => {
    await inbox.database.delete(inbox.comments);
    const live = storedComment("live", { root: "written-slug" });
    const withdrawn = storedComment("withdrawn", { root: "written-slug", deletedAt: "2026-10-19T00:00:00Z" });
    const github = storedComment("github", {
      source: SOURCES.github, identifier: "123", activityId: null, objectId: null, inReplyTo: null,
      submissionId: "93dd7f06-26c1-4c35-9a73-79df6ec41607", root: "written-slug",
    });
    for (const row of [live, withdrawn, github]) await inbox.insertComment(inbox.database, row);
    assert.deepEqual(await inbox.replyCounts(["written-slug", "8nicubmr"]), new Map([["written-slug", 1]]));
    assert.deepEqual((await inbox.replies("written-slug")).map((row) => row.objectId), [live.objectId]);
    assert.deepEqual(await inbox.withdrawnMany(["written-slug"]), new Map([["written-slug", new Map([[withdrawn.id, withdrawn.deletedAt]])]]));
    assert.deepEqual(await inbox.replies(`${ownActor}/notes/written-slug`), []);
  });
});

function followerStore(initial) {
  const followers = new Map(initial.map((entry) => [entry.actorUrl, { ...entry }]));
  const departures = [];
  return {
    departures,
    store: {
      async add(follower) {
        followers.set(follower.actorUrl, { ...follower });
        return true;
      },
      async remove(actorUrl) {
        return followers.delete(actorUrl);
      },
      async departure(actorUrl) {
        departures.push(actorUrl);
      },
    },
    read() {
      return [...followers.values()];
    },
  };
}

test("Follow records the follower and sends an Accept for the same activity", async () => {
  const state = followerStore([]);
  const accepts = [];

  await handleFollow(
    {
      id: "https://remote.example/activities/follow-1",
      actorId: firstFollower.actorUrl,
      objectId: ownActor,
    },
    firstFollower,
    ownActor,
    state.store,
    async (accept) => accepts.push(accept),
  );

  assert.deepEqual(state.read(), [firstFollower]);
  assert.deepEqual(accepts, [{
    id: "https://remote.example/activities/follow-1",
    actorId: firstFollower.actorUrl,
    objectId: ownActor,
  }]);
});

test("a Follow for another actor records nothing and sends no Accept", async () => {
  const state = followerStore([]);
  const accepts = [];

  await handleFollow(
    {
      id: "https://remote.example/activities/follow-2",
      actorId: firstFollower.actorUrl,
      objectId: "https://elsewhere.example/users/other",
    },
    firstFollower,
    ownActor,
    state.store,
    async (accept) => accepts.push(accept),
  );

  assert.deepEqual(state.read(), []);
  assert.deepEqual(accepts, []);
});

test("Undo{Follow} removes the matching follower", async () => {
  const state = followerStore([firstFollower]);

  assert.equal(await handleUndoFollow(firstFollower.actorUrl, state.store), true);

  assert.deepEqual(state.read(), []);
  assert.deepEqual(state.departures, [firstFollower.actorUrl]);
});

test("an Undo{Follow} from someone not following records no departure", async () => {
  const state = followerStore([firstFollower]);

  assert.equal(await handleUndoFollow("https://remote.example/users/two", state.store), false);

  assert.deepEqual(state.read(), [firstFollower]);
  assert.deepEqual(state.departures, []);
});

test("a Follow the store refuses sends no Accept", async () => {
  const accepts = [];
  const refused = await handleFollow(
    { id: "https://remote.example/activities/follow-3", actorId: firstFollower.actorUrl, objectId: ownActor },
    firstFollower,
    ownActor,
    { add: async () => false, remove: async () => false },
    async (accept) => accepts.push(accept),
  );

  assert.equal(refused, false);
  assert.deepEqual(accepts, []);
});

test("Undo from a different actor than the Follow does not remove a follower", {
  todo: "the embedded Follow actor and object are not checked against Undo.actor and our actor",
});
