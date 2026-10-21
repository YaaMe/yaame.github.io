import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../src/services/interactions/schema.ts";
import { insertComment } from "../src/integrations/activitypub/store/write-comment.ts";
import { SOURCES, commentId } from "../src/lib/interactions/key-scheme.ts";
import { storedComment } from "./fixtures/interactions.mjs";
import { testDatabase } from "./fixtures/databases.mjs";

for (const host of ["node", "d1"]) {
  test(`${host}: a failed comment insert leaves its identity for a later retry`, async (context) => {
    const { database, execute, rows } = await testDatabase(context, host);
    await migrate(database);
    const comment = storedComment("retry");
    await execute("CREATE TRIGGER refuse_comment BEFORE INSERT ON comments BEGIN SELECT RAISE(ABORT, 'injected comment failure'); END");
    await assert.rejects(insertComment(database, comment), (error) => {
      assert.match(error.cause?.message ?? "", /injected comment failure/);
      return true;
    });
    assert.deepEqual((await rows("SELECT id FROM visitor_identities")).map(({ id }) => id), [comment.authorId]);
    assert.deepEqual(await rows("SELECT * FROM comments"), []);
    await execute("DROP TRIGGER refuse_comment");
    assert.equal(await insertComment(database, comment), true);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 1);
    assert.deepEqual((await rows("SELECT id FROM comments")).map(({ id }) => id), [comment.id]);
  });

  test(`${host}: receipt and concurrent first deliveries use computed primary keys`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const first = storedComment("one");
    assert.deepEqual((await Promise.all([insertComment(database, first), insertComment(database, first)])).sort(), [false, true]);
    const second = storedComment("two", { activityId: first.activityId });
    assert.equal(await insertComment(database, second), true);
    const another = storedComment("another", { identifier: first.identifier });
    await Promise.all([insertComment(database, another), insertComment(database, another)]);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 2);
    assert.equal((await rows("SELECT * FROM comments")).length, 3);
    for (const invalid of [
      { ...first, id: second.id },
      { ...first, id: commentId({ ...first, objectId: first.activityId }) },
      { ...first, authorId: second.authorId },
      { ...first, objectId: "https://other.example/note" },
      { ...first, root: "https://example.test/root" },
      { ...first, replyTo: first.objectId },
      { ...first, activityId: "ftp://example.test/create" },
      { ...first, activityId: "https://other.example/create" },
      { ...first, activityId: null },
      { ...first, objectId: null },
      { ...first, submissionId: "93dd7f06-26c1-4c35-9a73-79df6ec41607" },
    ]) assert.equal(await insertComment(database, invalid), false);
    assert.equal((await rows("SELECT * FROM comments")).length, 3);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 2);
  });

  test(`${host}: GitHub comments retain the numeric identity and form UUID without federated attributes`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const comment = storedComment("github", {
      source: SOURCES.github, identifier: "00123", activityId: null, objectId: null, inReplyTo: null,
      submissionId: "93DD7F06-26C1-4C35-9A73-79DF6EC41607",
    });
    assert.equal(await insertComment(database, comment), true);
    assert.equal(await insertComment(database, comment), false);
    const [saved] = await rows("SELECT * FROM comments");
    assert.equal(saved.identifier, "00123");
    assert.equal(saved.submission_id, comment.submissionId);
    assert.equal(await insertComment(database, { ...comment, objectId: "https://example.test/note" }), false);
  });

  test(`${host}: concurrent Creates of the same Note keep one comment and its first delivery`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const first = storedComment("rewrapped");
    const second = storedComment("rewrapped", { activityId: "https://example.test/activity/rewrapped-again" });
    assert.deepEqual((await Promise.all([insertComment(database, first), insertComment(database, second)])).sort(), [false, true]);
    const [saved] = await rows("SELECT * FROM comments");
    assert.equal(saved.id, first.id);
    assert.ok([first.activityId, second.activityId].includes(saved.activity_id));
    assert.equal((await rows("SELECT * FROM comments")).length, 1);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 1);
    assert.equal(await insertComment(database, { ...first, objectId: "https://example.test/object/another" }), false);
  });
}
