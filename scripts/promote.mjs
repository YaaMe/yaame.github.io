#!/usr/bin/env node
/**
 * 把运行时收下的评论,有筛选地拉回 git。
 *
 *   make promote          看会写什么，不动任何东西
 *   make promote APPLY=1  真的写文件并回写数据库
 *
 * 为什么要有这一步:数据库是全量收件箱,git 是你挑过的那一份。
 * **把陌生人的话放进公开仓库是一个不可撤销的承诺** —— git 是永久的、被索引的、
 * 全世界可读的,而对方写下那句话时并不知道会落到这里。所以默认什么都不进,
 * 进去的每一条都是有人挑过的(规则在 scripts/promote-filter.mjs)。
 *
 * 只能在本地跑。它要同时够得着数据库和工作区,而 CI 两样都不该有:运行时没有
 * git 令牌,部署没有数据库凭据,这是有意的分隔。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import filter from "./promote-filter.mjs";

/**
 * 把对方给的 HTML 提取成文本。
 *
 * 进 git 的是文本而不是 HTML,理由不是安全(虽然顺带解决了),是**呈现权**:
 * 存 HTML 等于把别人的标记选择固化进我们的内容,站点以后想换个样子就得先跟
 * 那份标记打架。文本留着这个自由,而发给 Mastodon 的那次转换是我们自己写的、
 * 固定的。
 *
 * 段落和链接都留下来:`</p>` 和 `<br>` 变换行,`<a href="U">T</a>` 留下 T 并在
 * 后面补上 U —— 唯一的损失是锚文本和地址不再是一个东西,而 Mastodon 上的内容
 * 本来就以句子加链接为主。
 *
 * 这里用正则解析 HTML,而消毒器绝不能这么写。区别在于**输出经不经过转义**:
 * 这里的产物是纯文本,渲染时必然被转义,解析错了顶多难看;消毒器的产物要原样
 * 进页面,它的每个边角情况都是安全边界。
 */
function toText(html) {
  const entities = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    "&apos;": "'", "&nbsp;": " ",
  };
  return html
    .replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, inner) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      // 锚文本本身就是那个地址时不要写两遍 —— Mastodon 常把长链接截断显示。
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

/** 从 D1 取一次。--json 之外还有横幅，所以只认最后一个 JSON 数组。 */
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
 * 一条评论落到哪个文件。
 *
 * 长文一篇一个,短推按年归档 —— 短推会很多,一条一个文件就成了一地碎屑。
 * 这里只认长文;短推还不存在,等它存在了再补这一支,而不是现在猜它的 id 长什么样。
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

// 按线程分组：filter 拿到的是一整条链，不是单条。判断需要上下文 ——
// 只看一条的话，「保留整条回复链」根本表达不出来。
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

  // 已有内容读进来合并。重跑一次不该产生重复，也不该覆盖之前挑过的。
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

// 回写在写文件之后：先记数据库再写文件的话，一次失败的写入会让这些评论
// 被当成已提升，而 git 里没有它们 —— 那是一种再也不会被重试的丢失。
const list = promoted.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
query(
  `UPDATE comments SET promoted_at = '${new Date().toISOString()}' WHERE activity_id IN (${list})`,
);
console.log(`\n  已提升 ${promoted.length} 条，数据库已回写。`);
console.log("  现在 git status 看一眼，满意再提交 —— 进了 git 就撤不回来了。");
