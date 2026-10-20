import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deleteSql, main, selectSql } from "../scripts/unpromote.mjs";
import { comments } from "../src/config/data.config.generated.mjs";
import { archivedComment as entry, physicalComment } from "./fixtures/interactions.mjs";

test("unpromote previews without touching git or SQL", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-unpromote-preview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  writeFileSync(path, `${JSON.stringify({ comments: [entry()] })}\n`);
  const result = main({
    id: entry().id,
    dir,
    rows: [physicalComment()],
    apply: false,
  });
  assert.equal(result.changed, true);
  assert.equal(result.deleteId, undefined);
  assert.equal(result.archive.path, path);
  assert.equal(result.d1.id, entry().id);
  assert.equal(existsSync(path), true);
});

test("unpromote deletes the git entry before deleting its SQL row", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-unpromote-apply-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  writeFileSync(path, `${JSON.stringify({ comments: [entry()] })}\n`);
  const result = main({
    id: entry().id,
    dir,
    rows: [physicalComment()],
    apply: true,
  });
  assert.equal(existsSync(path), false);
  assert.equal(result.deleteId, entry().id);
});

test("unpromote deletes a D1-only row without inventing an archive path", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "blogu-52-unpromote-d1-only-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = physicalComment("only-d1", { content: "<p>stored only in D1</p>" });
  const preview = main({ id: target.id, dir, rows: [target], apply: false });
  assert.equal(preview.archive.present, false);
  assert.equal(preview.d1.present, true);
  const applied = main({ id: target.id, dir, rows: [target], apply: true });
  assert.equal(applied.deleteId, target.id);
});

test("unpromote refuses an id absent from both stores", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "blogu-52-unpromote-missing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(
    () => main({ id: entry("missing").id, dir, rows: [], apply: false }),
    /not a promoted comment/i,
  );
});

test("unpromote removes only the requested internal ID and preserves its neighbour", (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-unpromote-neighbour-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  const target = entry("target");
  const neighbour = entry("neighbour");
  writeFileSync(path, `${JSON.stringify({ comments: [target, neighbour] })}\n`);
  const result = main({ id: target.id, dir, rows: [physicalComment("target"), physicalComment("neighbour")], apply: true });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).comments, [neighbour]);
  assert.equal(result.deleteId, target.id);
  assert.notEqual(result.deleteId, target.activityId);
});

test("unpromote's statements carry the id as one quoted SQL string", () => {
  const where = `WHERE ${comments.quotedColumns.id} = 'o''brien'`;
  assert.equal(deleteSql("o'brien"), `DELETE FROM ${comments.table} ${where}`);
  assert.ok(selectSql("o'brien").endsWith(`\n   ${where}`));
});
