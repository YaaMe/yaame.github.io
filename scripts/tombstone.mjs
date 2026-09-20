#!/usr/bin/env node
/**
 * Remove comments that reached git and were later withdrawn.
 *
 *   node scripts/tombstone.mjs          show what would change
 *   APPLY=1 node scripts/tombstone.mjs  write it
 *
 * The runtime already stopped serving them the moment the `Delete` arrived,
 * which is where ActivityPub §7.4 is satisfied. What the runtime cannot reach is
 * git, so this reads the pair out, rewrites the files and opens a pull request
 * for a person to decide on.
 *
 * The entry goes, rather than being blanked. Withdrawal means the words go,
 * and a row saying someone spoke here is still a record of them. The one
 * exception is a comment something else replies to: that keeps a tombstone,
 * because the reply below it would otherwise be answering nothing.
 *
 * **History is not rewritten.** The commit is the record — the promise was
 * never that it did not exist, but that it is gone now.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
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

/**
 * Applied to a fixed point: removing a reply can leave the tombstone above it
 * with nothing left to hold up, so a leaf's departure can make its parent a
 * leaf in turn.
 *
 * An existing `deletedAt` marks one already dealt with. Judged from the file
 * itself — a column recording whether git was updated would disagree with
 * git's actual contents sooner or later.
 */
function rewrite(comments) {
  let list = comments;
  for (;;) {
    const answered = new Set(list.map((c) => c.replyToId).filter(Boolean));
    const next = [];
    let moved = false;
    for (const c of list) {
      const at = when.get(c.activityId);
      if (at === undefined && c.deletedAt === undefined) {
        next.push(c);
        continue;
      }
      if (!answered.has(c.objectId)) {
        moved = true;
        continue;
      }
      if (c.deletedAt === undefined) {
        const { content, ...rest } = c;
        next.push({ ...rest, deletedAt: at });
        moved = true;
      } else {
        next.push(c);
      }
    }
    if (!moved) return list;
    list = next;
  }
}

for (const file of files(DIR)) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const after = rewrite(doc.comments);
  if (JSON.stringify(after) === JSON.stringify(doc.comments)) continue;

  const gone = doc.comments.length - after.length;
  const stones = after.filter((c) => c.deletedAt !== undefined).length;
  changed += gone + stones;
  console.log(`  ${file}：移除 ${gone} 条，留下 ${stones} 块墓碑（有回复指向）`);

  if (!APPLY) continue;
  // An empty file describes a conversation that is not there. `git add` on the
  // directory stages the removal the same as an edit.
  if (after.length === 0) rmSync(file);
  else writeFileSync(file, `${JSON.stringify({ ...doc, comments: after }, null, 2)}\n`);
}

if (changed === 0) {
  console.log("  都已经处理过了");
  process.exit(0);
}

console.log(`\n  ${changed} 条${APPLY ? "已处理" : "会被处理（加 APPLY=1 才动手）"}`);
