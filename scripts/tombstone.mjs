#!/usr/bin/env node
/**
 * Turn comments that reached git and were later withdrawn into tombstones.
 *
 *   node scripts/tombstone.mjs          show what would change
 *   APPLY=1 node scripts/tombstone.mjs  write it
 *
 * The runtime already stopped serving them the moment the `Delete` arrived,
 * which is where ActivityPub §7.4 is satisfied. What the runtime cannot reach is
 * git, so this reads the pair out, rewrites the files and opens a pull request
 * for a person to decide on.
 *
 * **History is not rewritten.** After the merge the content is gone and the
 * record stays: written by X at T1, withdrawn at T2. The promise was never that
 * it did not exist, but that the record says it was withdrawn — and the commit
 * is that record.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.env.APPLY === "1";
const DB = "yaame-ap-interactions";
const DIR = "src/content/comments";

function query(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const start = out.indexOf("[");
  if (start < 0) throw new Error(`看不懂 wrangler 的输出：${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start))[0].results;
}

function* files(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (name.endsWith(".json")) yield path;
  }
}

// The intersection of the two columns is the whole of the work. A separate
// queue table would be a copy of this query that goes stale.
const pending = query(
  `SELECT activity_id, deleted_at FROM comments
   WHERE deleted_at IS NOT NULL AND promoted_at IS NOT NULL`,
);

if (pending.length === 0) {
  console.log("  没有要立碑的");
  process.exit(0);
}

const when = new Map(pending.map((r) => [r.activity_id, r.deleted_at]));
let changed = 0;

for (const file of files(DIR)) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  let touched = false;

  for (const comment of doc.comments) {
    const at = when.get(comment.activityId);
    // An existing `deletedAt` means this one is already a tombstone. Judged
    // from the file itself: a column recording whether git was updated would
    // disagree with git's actual contents sooner or later.
    if (!at || comment.deletedAt) continue;
    delete comment.content;
    comment.deletedAt = at;
    touched = true;
    changed++;
    console.log(`  ${file}：${comment.activityId}`);
  }

  if (touched && APPLY) writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

if (changed === 0) {
  console.log("  都已经立过碑了");
  process.exit(0);
}

console.log(`\n  ${changed} 条${APPLY ? "已改成墓碑" : "会被改成墓碑（加 APPLY=1 才动手）"}`);
