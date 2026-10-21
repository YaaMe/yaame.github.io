import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Follow, Like, Undo } from "@fedify/fedify/vocab";
import { schemaBootstrapStatements } from "../src/services/interactions/schema.ts";
import { inboxHarness } from "./fixtures/inbox.mjs";

const ownActor = "https://yaame.dev/users/yaame";
const friend = "https://remote.example/users/friend";

// A database the reactions migration refuses: an unapproved reaction arrived before deploy.
function refusedDatabase(context) {
  const directory = mkdtempSync(join(tmpdir(), "blogu-undo-follow-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "interactions.sqlite");
  const client = new DatabaseSync(file);
  try {
    for (const statement of schemaBootstrapStatements().slice(0, 1 + 5 + 9)) client.exec(statement);
    for (let version = 0; version < 6; version++) client.exec(`INSERT INTO migrations VALUES (${version}, 'before')`);
    client.exec(`INSERT INTO reactions VALUES ('${friend}/likes/1', '${ownActor}/notes/example', '${friend}', 'Like', '2026-10-19T00:00:00Z', NULL)`);
  } finally {
    client.close();
  }
  return file;
}

// Followers live in the interactions database, so an unfollow it cannot reach
// must fail and be redelivered rather than be acknowledged with the row kept.
test("an Undo is refused, not acknowledged, while the interactions database cannot open", async (t) => {
  const inbox = await inboxHarness(t, { databaseUrl: refusedDatabase(t), openStore: false });
  await assert.rejects(inbox.store(), /reactions_drop_requires_approved_snapshot/);
  const deliver = async (activity) => {
    const dispatched = inbox.federation.inboxListeners.dispatchWithClass(activity);
    assert.ok(dispatched);
    await dispatched.listener({}, activity);
  };

  await t.test("Undo of an embedded Follow reports the failure", async () => {
    const follow = new Follow({ id: new URL("https://remote.example/activities/follow"), actor: new URL(friend), object: new URL(ownActor) });
    await assert.rejects(
      deliver(new Undo({ id: new URL("https://remote.example/activities/unfollow"), actor: new URL(friend), object: follow })),
      /reactions_drop_requires_approved_snapshot/,
    );
  });

  await t.test("Undo of a reaction still reports the failed lookup", async () => {
    const like = new Like({ id: new URL(`${friend}/likes/1`), actor: new URL(friend), object: new URL(`${ownActor}/notes/example`) });
    await assert.rejects(
      deliver(new Undo({ id: new URL("https://remote.example/activities/unlike"), actor: new URL(friend), object: like })),
      /reactions_drop_requires_approved_snapshot/,
    );
  });
});
