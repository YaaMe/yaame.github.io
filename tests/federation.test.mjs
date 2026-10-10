import test from "node:test";
import assert from "node:assert/strict";
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
