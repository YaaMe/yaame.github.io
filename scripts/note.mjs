#!/usr/bin/env node
/**
 * 写一条短文。
 *
 *   make po test
 *   make po 今天读完了这本书 https://example.com
 *   make po T="正文里有 # 或 $ 时用这个"
 *
 * 追加到 src/content/notes/<当年>.json。正文当 markdown 看 —— 纯文字也是
 * 合法的 markdown,而带链接的短文不解析就只能显示裸 URL。
 *
 * 这是两条发布线里的**终端那条**:直接写 git,提交、部署之后可见。另一条是
 * 路由层登录后写 D1、立刻联邦可见、之后再提升回 git。两条最终都落在同一个
 * 地方,只是先后不同。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/content/notes";
const text = process.argv.slice(2).join(" ").trim();

if (!text) {
  console.error("  用法：make po 正文    或    make po T=\"正文\"");
  process.exit(1);
}

/**
 * id 和时间是两回事。
 *
 * 一天发几条都有可能,所以时间当不了身份。用非日期形状的短串,还有一个好处:
 * 长文的 slug 是日期形状(`2025-year`、`2023-07`),两者共用 `/users/…/notes/`
 * 这个命名空间也不会撞。
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 去掉 l/o/0/1，念出来不会错
const makeId = () =>
  Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

// 所有年份里的 id 都读一遍。碰撞的概率可以忽略，但"可以忽略"和"检查过了"
// 之间的差别，正是这个文件里唯一不可撤销的东西：id 一旦发布出去就是它的身份。
const taken = new Set();
if (existsSync(DIR)) {
  for (const name of readdirSync(DIR)) {
    if (!name.endsWith(".json")) continue;
    for (const note of JSON.parse(readFileSync(join(DIR, name), "utf8")).notes) {
      taken.add(note.id);
    }
  }
}

let id = makeId();
while (taken.has(id)) id = makeId();

const now = new Date();
const file = join(DIR, `${now.getUTCFullYear()}.json`);
const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { notes: [] };

doc.notes.push({ id, published: now.toISOString().replace(/\.\d{3}Z$/, "Z"), content: text });
doc.notes.sort((a, b) => a.published.localeCompare(b.published));

mkdirSync(DIR, { recursive: true });
writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);

console.log(`  ${file}  ${id}`);
console.log(`  ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
console.log("\n  提交并部署之后它会被投递给关注者。");
