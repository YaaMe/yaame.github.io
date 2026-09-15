#!/usr/bin/env node
/**
 * 补全文章 frontmatter 里的 description 和 tags。
 *
 *   node scripts/frontmatter.mjs            补缺失的，就地写入
 *   node scripts/frontmatter.mjs --dry-run  只看会改什么
 *   node scripts/frontmatter.mjs --check    有缺失就退出码 1（给 CI 用），不写
 *   node scripts/frontmatter.mjs --force    连已有的一起覆盖
 *
 * 默认【只补缺失的】—— 手写的摘要永远不会被机器覆盖。
 * 自动摘要的质量只够当占位，写得好的那句该由人来写。
 *
 * 注意：这里用正则处理 frontmatter，不是完整的 YAML 解析。
 * 只动 description 和 tags 两行，其余（含 +08:00 时区标记、带引号的 title）原样保留。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/content/posts";
const FIELD = { desc: "description", tags: "tags" }; // 换主题时改这里（astro-paper 用同名）

const MAX = 30;              // 摘要上限（汉字计）
const SENTENCE_END = /[。！？]/;

const argv = new Set(process.argv.slice(2));
const dry = argv.has("--dry-run");
const check = argv.has("--check");
const force = argv.has("--force");

/** 从正文取一句话当摘要：优先在句末标点处断，否则截断加省略号。 */
function makeDescription(body, fallback) {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    // 跳过图片、标题、列表、引用、表格、分隔线
    if (!line || /^([!#>|]|[-+*]\s|-{3,}|\d+\.\s)/.test(line)) continue;
    const m = line.match(new RegExp(`^(.{4,${MAX}}?${SENTENCE_END.source})`));
    if (m) return m[1];
    return line.length > MAX - 2 ? line.slice(0, MAX - 2) + "…" : line;
  }
  return fallback;
}

/** 从文件名推断标签。本站的命名约定：YYYY-year 是年结，YYYY-MM 是月结。 */
function inferTags(slug) {
  if (/^\d{4}-year$/.test(slug)) return ["summarize", "year"];
  if (/^\d{4}-\d{2}$/.test(slug)) return ["summarize", "month"];
  return null;   // 认不出来就不猜，交给人
}

const has = (fm, key) => new RegExp(`^${key}:\\s*\\S`, "m").test(fm);

let changed = 0, missing = 0;
for (const name of readdirSync(DIR).filter((f) => f.endsWith(".md")).sort()) {
  const path = join(DIR, name);
  const slug = name.replace(/\.md$/, "");
  const src = readFileSync(path, "utf8");
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) { console.warn(`  跳过 ${name}：没有 frontmatter`); continue; }

  let [, fm, body] = m;
  const before = fm;
  const title = (fm.match(/^title:\s*"?(.*?)"?\s*$/m) || [, slug])[1];

  if (force || !has(fm, FIELD.desc)) {
    const d = makeDescription(body, title).replace(/"/g, "'");
    const line = `${FIELD.desc}: "${d}"`;
    fm = has(fm, FIELD.desc) || /^description:/m.test(fm)
      ? fm.replace(/^description:.*$/m, line)
      : `${fm}\n${line}`;
  }

  if (force || !has(fm, FIELD.tags)) {
    const t = inferTags(slug);
    if (t) {
      const line = `${FIELD.tags}:\n${t.map((x) => `  - ${x}`).join("\n")}`;
      fm = /^tags:/m.test(fm)
        ? fm.replace(/^tags:(\n(  - .*|\s*))*$/m, line)
        : `${fm}\n${line}`;
    } else {
      missing++;
      console.log(`  ? ${name} 缺 tags，文件名认不出类型 —— 需要人工`);
    }
  }

  if (fm !== before) {
    changed++;
    console.log(`  ${dry || check ? "会改" : "已改"} ${name}`);
    if (!dry && !check) writeFileSync(path, `---\n${fm}\n---\n${body}`);
  }
}

console.log(`\n  ${changed} 个文件需要补全，${missing} 个需要人工处理`);
if (check && (changed || missing)) {
  console.error("  --check：有未补全的 frontmatter");
  process.exit(1);
}
