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
 * Local only: this needs the database and the working tree at once, and CI is
 * deliberately denied both — the runtime holds no git token, the deploy holds no
 * database credentials.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import filter from "./promote-filter.mjs";

/**
 * Extract text from the sender's HTML.
 *
 * Paragraphs and links survive: `</p>` and `<br>` become newlines, and
 * `<a href="U">T</a>` keeps T with U after it. What is lost is anchor text and
 * target being one thing. See
 * docs/decisions/0006-promoted-comments-are-stored-as-text.md.
 *
 * HTML is parsed here with regular expressions, which a sanitiser must never
 * do. The difference is whether the output is escaped: this output is plain
 * text and is escaped at render time, so a mis-parse is ugly. A sanitiser's
 * output goes onto the page verbatim, and every edge case is a security
 * boundary.
 */
function toText(html) {
  const entities = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    "&apos;": "'", "&nbsp;": " ",
  };
  return html
    .replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, inner) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      // Not twice when the anchor text is the address: Mastodon routinely
      // truncates a long link for display.
      return !label || url.startsWith(label) || label.startsWith(url) ? url : `${label}（${url}）`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;/gi, (e) => entities[e.toLowerCase()] ?? e)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const APPLY = process.env.APPLY === "1";
const DB = "yaame-ap-interactions";
const DIR = "src/content/comments";

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
 * One file per long post; notes will be archived by year, since one file each
 * would be a drift of fragments. Only long posts are recognised here — the
 * branch for notes lands when notes have comments, rather than on a guess about
 * what their ids will look like.
 */
function fileFor(rootId) {
  const m = /\/users\/[^/]+\/notes\/([^/?#]+)$/.exec(rootId);
  if (!m) return null;
  return join(DIR, "posts", `${m[1]}.json`);
}

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
  thread.push({
    activityId: r.activity_id,
    objectId: r.object_id,
    rootId: r.root_id,
    replyToId: r.reply_to_id,
    actorId: r.actor_id,
    content: r.content,
    published: r.published,
  });
  threads.set(r.root_id, thread);
}

console.log(`  待提升 ${rows.length} 条，分属 ${threads.size} 条线程`);

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
    existing.push(c);
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
