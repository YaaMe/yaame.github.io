#!/usr/bin/env node
/**
 * 把「已经进了 git 而后被要求删除」的评论换成墓碑。
 *
 *   node scripts/tombstone.mjs          看会改什么
 *   APPLY=1 node scripts/tombstone.mjs  真的改
 *
 * 运行时收到 `Delete` 的那一刻就已经停止呈现了 —— 标记 `deleted_at`、清空内容,
 * 自动、秒级,这一步本身就满足规范 §7.4。git 里那一份运行时够不着,所以走这里:
 * 一周一次读出来、改成墓碑、开 PR,由人决定合不合。
 *
 * **不改写历史。** 合并之后内容没了,事实留着:
 *
 *     这条评论由 X 在 T1 发表，于 T2 被删除
 *
 * 我们许诺的从来不是"它不曾存在",而是"记录显示它被删除了" —— 而那次提交本身
 * 就是那份记录。
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

// 「进了 git 之后又被删除」就是这两列的交集。不需要单独的待办表 —— 那张表
// 会是这个查询的一份会过期的副本。
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
    // 已经有 deletedAt 的说明立过碑了。用文件自身的状态判断，而不是在数据库里
    // 再记一列「git 那边做完了没有」—— 那一列会和 git 的实际内容各说各话。
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
