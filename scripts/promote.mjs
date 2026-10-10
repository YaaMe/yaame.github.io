#!/usr/bin/env node
/**
 * Carry selected comments from the runtime store back into git.
 *
 *   make promote          show what would be written, touch nothing
 *   make promote APPLY=1  write the files and record it in the database
 *
 * The database is the whole inbox; git is the part you chose. **Putting a
 * stranger's words into a public repository is irreversible** — git is
 * permanent, indexed and world-readable, and they did not know it would land
 * there when they wrote it. So nothing is promoted by default and every row
 * that goes in was selected by the rule in scripts/promote-filter.mjs.
 *
 * Local only: no workflow runs it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import filter from "./promote-filter.mjs";
import { toContent } from "./promote-text.mjs";

const APPLY = process.env.APPLY === "1";
const DB = "yaame-ap-interactions";
const DIR = "src/content/comments";
const NOTES = "src/content/notes";

/** One read from D1. `--json` still prints a banner, so only the array counts. */
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

/**
 * Which file a comment belongs in.
 *
 * Long-post threads use one file per object. Note threads use the year archive
 * that contains their root note, so the page and the archive have one owner.
 */
function noteYear(id) {
  let files;
  try {
    files = readdirSync(NOTES);
  } catch {
    return null;
  }
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const doc = JSON.parse(readFileSync(join(NOTES, name), "utf8"));
    if (doc.notes.some((note) => note.id === id)) return name.slice(0, -5);
  }
  return null;
}

export function fileFor(rootId) {
  const m = /\/users\/[^/]+\/notes\/([^/?#]+)$/.exec(rootId);
  if (!m) return null;
  const year = noteYear(m[1]);
  return join(DIR, year === null ? "posts" : "notes", `${year ?? m[1]}.json`);
}

export function promotedComment(row) {
  return {
    activityId: row.activity_id,
    objectId: row.object_id,
    rootId: row.root_id,
    replyToId: row.reply_to_id,
    actorId: row.actor_id,
    content: toContent(row.content),
    published: row.published,
  };
}

async function main() {
  const rows = query(
    `SELECT activity_id, object_id, root_id, reply_to_id, actor_id, content, published
     FROM comments
     WHERE promoted_at IS NULL AND deleted_at IS NULL
     ORDER BY published ASC`,
  );

  if (rows.length === 0) {
    console.log("  没有待提升的评论");
    process.exit(0);
  }

  // Grouped by thread: a filter receives the whole chain, because "keep the
  // entire reply chain" cannot be expressed from a single row.
  const threads = new Map();
  for (const r of rows) {
    const thread = threads.get(r.root_id) ?? [];
    thread.push(promotedComment(r));
    threads.set(r.root_id, thread);
  }

  console.log(`  待提升 ${rows.length} 条，分属 ${threads.size} 条线程`);

  /**
   * What an actor calls itself, at the moment of promotion.
   *
   * Fetched at promotion, so the name is the one the actor used then. An actor
   * that has since gone leaves no name, and the page falls back to the handle.
   */
  const names = new Map();
  async function nameOf(actorId) {
    if (names.has(actorId)) return names.get(actorId);
    let name;
    try {
      const res = await fetch(actorId, { headers: { accept: "application/activity+json" } });
      if (res.ok) {
        const a = await res.json();
        name = typeof a.name === "string" && a.name.trim() ? a.name.trim() : a.preferredUsername;
      }
    } catch {
      // Unreachable, gone, or not answering ActivityPub. The handle is enough.
    }
    names.set(actorId, name);
    return name;
  }

  const writes = new Map();
  const promoted = [];

  for (const [rootId, thread] of threads) {
    const keep = filter(thread) ?? [];
    if (keep.length === 0) continue;

    const file = fileFor(rootId);
    if (file === null) {
      console.warn(`  ✗ 不认识的 root，跳过：${rootId}`);
      continue;
    }

    // Merged with what is already there: a re-run must not duplicate, and must
    // not overwrite what was selected before.
    const existing = writes.get(file) ?? (existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8")).comments
      : []);
    const seen = new Set(existing.map((c) => c.activityId));
    for (const c of keep) {
      if (seen.has(c.activityId)) continue;
      const name = await nameOf(c.actorId);
      existing.push(name ? { ...c, name } : c);
      promoted.push(c.activityId);
    }
    existing.sort((a, b) => a.published.localeCompare(b.published));
    writes.set(file, existing);
  }

  if (promoted.length === 0) {
    console.log("  筛选之后没有要留的（规则在 scripts/promote-filter.mjs）");
    process.exit(0);
  }

  for (const [file, comments] of writes) {
    console.log(`  ${APPLY ? "写入" : "将写入"} ${file}：共 ${comments.length} 条`);
    if (!APPLY) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ comments }, null, 2)}\n`);
  }

  if (!APPLY) {
    console.log(`\n  ${promoted.length} 条会被提升。加 APPLY=1 才会真的动手。`);
    process.exit(0);
  }

  // Recorded after the files are written. The other order lets a failed write
  // mark these as promoted while git does not hold them — a loss nothing retries.
  const list = promoted.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  query(
    `UPDATE comments SET promoted_at = '${new Date().toISOString()}' WHERE activity_id IN (${list})`,
  );
  console.log(`\n  已提升 ${promoted.length} 条，数据库已回写。`);
  console.log("  现在 git status 看一眼，满意再提交 —— 进了 git 就撤不回来了。");
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  await main();
}
