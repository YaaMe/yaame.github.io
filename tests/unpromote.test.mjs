import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../scripts/unpromote.mjs";

const id = (name) => `https://example.test/${name}`;

function entry() {
  return {
    activityId: id("activity/one"),
    objectId: id("object/one"),
    rootId: id("root"),
    actorId: id("actor"),
    content: [[{ type: "text", text: "one" }]],
    published: "2026-10-10T00:00:00Z",
    replyToId: null,
  };
}

test("unpromote previews without touching git or SQL", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-unpromote-preview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  writeFileSync(path, `${JSON.stringify({ comments: [entry()] })}\n`);
  const result = main({
    id: id("activity/one"),
    dir,
    rows: [{ activity_id: id("activity/one"), root_id: id("root") }],
    apply: false,
  });
  assert.equal(result.changed, true);
  assert.equal(result.deleteId, undefined);
  assert.equal(result.archive.path, path);
  assert.equal(result.d1.id, id("activity/one"));
  assert.equal(existsSync(path), true);
});

test("unpromote deletes the git entry before deleting its SQL row", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-unpromote-apply-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  writeFileSync(path, `${JSON.stringify({ comments: [entry()] })}\n`);
  const result = main({
    id: id("activity/one"),
    dir,
    rows: [{ activity_id: id("activity/one"), root_id: id("root") }],
    apply: true,
  });
  assert.equal(existsSync(path), false);
  assert.equal(result.deleteId, id("activity/one"));
});

test("unpromote deletes a D1-only row without inventing an archive path", () => {
  const dir = mkdtempSync(join(tmpdir(), "blogu-52-unpromote-d1-only-"));
  const target = {
    activity_id: id("activity/only-d1"),
    root_id: id("root"),
    actor_id: id("actor"),
    content: "<p>stored only in D1</p>",
  };
  const preview = main({ id: target.activity_id, dir, rows: [target], apply: false });
  assert.equal(preview.archive.present, false);
  assert.equal(preview.d1.present, true);
  const applied = main({ id: target.activity_id, dir, rows: [target], apply: true });
  assert.equal(applied.deleteId, target.activity_id);
});

test("unpromote refuses an id absent from both stores", () => {
  const dir = mkdtempSync(join(tmpdir(), "blogu-52-unpromote-missing-"));
  assert.throws(
    () => main({ id: id("activity/missing"), dir, rows: [], apply: false }),
    /not a promoted comment/i,
  );
});
