import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NAMESPACE, SOURCES, identityId, commentId, reactionId } from "../src/lib/interactions/key-scheme.ts";

test("stored v5 ids remain stable across builds", () => {
  const identifier = "https://remote.example/users/alice";
  assert.equal(identityId(SOURCES.activitypub, identifier), "41f8ae2c-2259-5c87-ae1e-a30790fca407");
  assert.equal(commentId({ source: SOURCES.activitypub, identifier, objectId: "https://remote.example/notes/1" }), "59b0de38-6b8a-5980-8041-4dd444e0f77b");
});

test("interaction keys are RFC v5 values computed from the stored source and inputs", () => {
  const identifier = "https://remote.example/users/one";
  const objectId = "https://remote.example/notes/one";
  const input = { source: SOURCES.activitypub, identifier, objectId };
  const bytes = createHash("sha1")
    .update(Buffer.from(NAMESPACE.replaceAll("-", ""), "hex"))
    .update(JSON.stringify([SOURCES.activitypub, identifier, objectId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  assert.equal(commentId(input).replaceAll("-", ""), bytes.toString("hex"));
  assert.equal(commentId(input), commentId({ ...input }));
  assert.notEqual(commentId(input), commentId({ ...input, identifier: "https://remote.example/users/two" }));
  assert.notEqual(commentId(input), commentId({ ...input, objectId: "https://remote.example/notes/two" }));
  assert.notEqual(identityId(input.source, identifier), commentId(input));
});

test("a federated comment key requires the Note and ignores the Create", () => {
  const input = { source: SOURCES.activitypub, identifier: "https://remote.example/users/one", objectId: "https://remote.example/notes/one" };
  assert.equal(commentId({ ...input, activityId: "https://remote.example/activities/first" }),
    commentId({ ...input, activityId: "https://remote.example/activities/second" }));
  assert.equal(commentId(input), commentId({ ...input, objectId: "HTTPS://REMOTE.EXAMPLE:443/notes/one" }));
  for (const objectId of [undefined, null, "", "ftp://remote.example/notes/one"]) {
    assert.throws(() => commentId({ ...input, objectId, activityId: "https://remote.example/activities/first" }));
  }
});

test("normalisation is deterministic without replacing raw inputs", () => {
  assert.equal(identityId(SOURCES.activitypub, "HTTPS://REMOTE.EXAMPLE:443"), identityId(SOURCES.activitypub, "https://remote.example/"));
  assert.equal(identityId(SOURCES.github, "00123"), identityId(SOURCES.github, "123"));
  const input = { source: SOURCES.github, identifier: "00123", submissionId: "93DD7F06-26C1-4C35-9A73-79DF6EC41607" };
  assert.equal(commentId(input), commentId({ ...input, identifier: "123", submissionId: input.submissionId.toLowerCase() }));
  assert.equal(input.identifier, "00123");
  assert.throws(() => identityId(SOURCES.activitypub, "ftp://remote.example/"));
  assert.throws(() => identityId(SOURCES.github, "login"));
  assert.throws(() => commentId({ ...input, submissionId: "not-a-uuid" }));
});

test("a reaction key is computed from its source, signing actor and activity", () => {
  const input = { source: SOURCES.activitypub, identifier: "https://remote.example/users/one", activityId: "https://remote.example/likes/1" };
  const bytes = createHash("sha1")
    .update(Buffer.from(NAMESPACE.replaceAll("-", ""), "hex"))
    .update(JSON.stringify([SOURCES.activitypub, input.identifier, input.activityId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  assert.equal(reactionId(input).replaceAll("-", ""), bytes.toString("hex"));
  assert.equal(reactionId({ ...input, objectId: "https://yaame.dev/users/yaame/notes/other" }), reactionId(input));
  assert.equal(reactionId({ ...input, activityId: "HTTPS://REMOTE.EXAMPLE:443/likes/1" }), reactionId(input));
  assert.notEqual(reactionId({ ...input, identifier: "https://remote.example/users/two" }), reactionId(input));
  assert.notEqual(reactionId({ ...input, activityId: "https://remote.example/likes/2" }), reactionId(input));
  for (const activityId of [undefined, null, "", "ftp://remote.example/likes/1"]) {
    assert.throws(() => reactionId({ ...input, activityId }));
  }
  assert.throws(() => reactionId({ ...input, source: SOURCES.github, identifier: "123" }));
});
