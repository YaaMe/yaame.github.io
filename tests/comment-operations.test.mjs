import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { archivePath } from "../src/selectors/interactions/comment-archive.ts";
import { planUnpromotion } from "../src/services/interactions/unpromote.ts";
import { archivedComment, physicalComment } from "./fixtures/interactions.mjs";

test("comment operation entries import under plain Node without runtime aliases", () => {
  const entries = [
    "src/services/interactions/promote.ts",
    "src/services/interactions/promote-text.ts",
    "src/services/interactions/promote-filter.ts",
    "src/services/interactions/tombstone.ts",
    "src/services/interactions/unpromote.ts",
    "src/services/interactions/comment-archive.ts",
    "src/selectors/interactions/comment-archive.ts",
  ];
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval",
    `for (const entry of ${JSON.stringify(entries)}) await import('./' + entry);`,
  ], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("archive selection uses the first matching note file and otherwise keeps the post slug", () => {
  const notes = [
    { name: "2024.json", document: { notes: [{ id: "stable-note" }] } },
    { name: "2026.json", document: { notes: [{ id: "stable-note" }] } },
  ];
  assert.deepEqual(archivePath("stable-note", notes), ["notes", "2024.json"]);
  assert.deepEqual(archivePath("written-slug", notes), ["posts", "written-slug.json"]);
  const unread = { *[Symbol.iterator]() { throw new Error("unexpected note read"); } };
  assert.equal(archivePath("../bad-root", unread), null);
});

test("unpromotion plans preserve snapshots and leave unrelated archive entries", () => {
  const target = archivedComment("target");
  const neighbour = archivedComment("neighbour");
  const document = { comments: [target, neighbour], retained: "metadata" };
  const rows = [physicalComment("target")];
  const before = JSON.stringify({ document, rows });
  const plan = planUnpromotion({ id: target.id, rows, documents: [{ path: "archive.json", document }] });
  assert.deepEqual(plan.write, { path: "archive.json", after: { comments: [neighbour], retained: "metadata" } });
  assert.equal(plan.deleteId, target.id);
  assert.equal(JSON.stringify({ document, rows }), before);
});
