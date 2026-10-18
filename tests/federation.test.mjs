import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Create, Note } from "@fedify/fedify/vocab";
import {
  handleCommentDelete,
  handleFollow,
  handleUndoFollow,
} from "../src/integrations/activitypub/inbox-handlers.ts";
import { visibleComments } from "../src/lib/comment-view.ts";

const ownActor = "https://yaame.dev/users/yaame";
const firstFollower = {
  id: "https://remote.example/users/one",
  inbox: "https://remote.example/users/one/inbox",
};

async function commentInbox(context) {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-comment-inbox-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const bundle = join(directory, "inbox.mjs");
  await build({
    stdin: {
      contents: `
        export { federation } from "./src/integrations/activitypub/federation.ts";
        export { store } from "./src/integrations/activitypub/store/comments.ts";
        export { comments } from "./src/integrations/activitypub/store/schema.ts";
      `,
      resolveDir: process.cwd(),
    },
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    alias: { "virtual:platform": resolve("src/platform/node.ts") },
    define: { "process.env.AP_DB_URL": JSON.stringify(":memory:") },
  });
  const inbox = await import(pathToFileURL(bundle).href);
  const database = await inbox.store();
  context.after(() => database.$client.close());
  context.mock.method(globalThis, "fetch", async () => {
    throw new Error("comment inbox tests are offline");
  });
  return {
    ...inbox,
    database,
    async receive(activity, stored = []) {
      await database.delete(inbox.comments);
      if (stored.length > 0) await database.insert(inbox.comments).values(stored);
      const dispatched = inbox.federation.inboxListeners.dispatchWithClass(activity);
      assert.ok(dispatched);
      await dispatched.listener({}, activity);
      return database.select().from(inbox.comments);
    },
  };
}

test("Create comments keep HTTP(S) identifiers and the signed actor", async (t) => {
  const inbox = await commentInbox(t);
  const friend = "https://mastodon.social/users/friend";
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
    assert.equal(rows[0].actorId, friend);
    assert.equal(rows[0].rootId, root);
    assert.equal(rows[0].replyToId, null);
  });

  await t.test("an absent attribution uses the signed actor", async () => {
    const rows = await inbox.receive(createComment({ attributionId: null }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actorId, friend);
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
    assert.equal(rows[0].actorId, "http://remote.example/users/friend");
  });

  for (const field of ["replyToId", "rootId"]) {
    await t.test(`${field} requires HTTP(S) when continuing a stored thread`, async () => {
      const parent = {
        activityId: "https://remote.example/activities/parent",
        objectId: field === "replyToId" ? "ftp://example.test/reference" : "https://remote.example/notes/parent",
        rootId: field === "rootId" ? "ftp://example.test/reference" : root,
        actorId: friend,
        content: "Parent",
        published: "2026-10-10T00:00:00Z",
        receivedAt: "2026-10-10T00:00:00Z",
      };
      const rows = await inbox.receive(createComment({ replyToId: parent.objectId }), [parent]);
      assert.deepEqual(rows.map(({ objectId }) => objectId), [parent.objectId]);
    });
  }

  await t.test("an HTTP(S) reply target keeps its stored root", async () => {
    const parent = {
      activityId: "https://remote.example/activities/parent",
      objectId: "http://remote.example/notes/parent",
      rootId: root,
      actorId: friend,
      content: "Parent",
      published: "2026-10-10T00:00:00Z",
      receivedAt: "2026-10-10T00:00:00Z",
    };
    const rows = await inbox.receive(createComment({ replyToId: parent.objectId }), [parent]);
    const reply = rows.find(({ objectId }) => objectId !== parent.objectId);
    assert.equal(rows.length, 2);
    assert.equal(reply.replyToId, parent.objectId);
    assert.equal(reply.rootId, root);
  });
});

function followerStore(initial) {
  let followers = initial.map((entry) => ({ ...entry }));
  const departures = [];
  return {
    departures,
    store: {
      async read() {
        return followers.map((entry) => ({ ...entry }));
      },
      async write(next) {
        followers = next.map((entry) => ({ ...entry }));
      },
      async departure(id) {
        departures.push(id);
      },
    },
    read() {
      return followers;
    },
  };
}

test("Follow records the follower and sends an Accept for the same activity", async () => {
  const state = followerStore([]);
  const accepts = [];

  await handleFollow(
    {
      id: "https://remote.example/activities/follow-1",
      actorId: firstFollower.id,
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
    actorId: firstFollower.id,
    objectId: ownActor,
  }]);
});

test("a Follow for another actor records nothing and sends no Accept", async () => {
  const state = followerStore([]);
  const accepts = [];

  await handleFollow(
    {
      id: "https://remote.example/activities/follow-2",
      actorId: firstFollower.id,
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

  await handleUndoFollow(firstFollower.id, firstFollower.id, state.store);

  assert.deepEqual(state.read(), []);
  assert.deepEqual(state.departures, [firstFollower.id]);
});

test("Undo from a different actor than the Follow does not remove a follower", {
  todo: "the embedded Follow actor and object are not checked against Undo.actor and our actor",
});

test("Delete marks a stored reply withdrawn and the comment view drops it", async () => {
  const reply = {
    objectId: "https://remote.example/notes/reply",
    actorId: firstFollower.id,
    replyToId: ownActor,
    content: "a reply",
    deletedAt: null,
  };

  const removed = await handleCommentDelete(reply.objectId, reply.actorId, async (objectId, actorId) => {
    if (objectId !== reply.objectId || actorId !== reply.actorId) return false;
    reply.content = undefined;
    reply.deletedAt = "2026-10-11T00:00:00Z";
    return true;
  });

  assert.equal(removed, true);
  assert.equal(reply.deletedAt, "2026-10-11T00:00:00Z");
  assert.deepEqual(visibleComments([reply]), []);
});
