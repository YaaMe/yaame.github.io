#!/usr/bin/env node
/**
 * Fill in a post's missing `description` and `tags`.
 *
 *   node scripts/frontmatter.mjs            fill what is missing, in place
 *   node scripts/frontmatter.mjs --dry-run  show what would change
 *   node scripts/frontmatter.mjs --check    exit 1 if anything is missing (CI)
 *   node scripts/frontmatter.mjs --force    overwrite what is already there
 *
 * Only what is missing, by default: a written description is never overwritten
 * by a generated one, which is good enough to be a placeholder and no more.
 *
 * Frontmatter is handled with regular expressions rather than parsed as YAML.
 * Only the `description` and `tags` lines are touched, so everything else — a
 * +08:00 offset, a quoted title — survives exactly as written.
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

/** One sentence from the body: cut at sentence punctuation, else truncate. */
function makeDescription(body, fallback) {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    // Skip images, headings, lists, quotes, tables and rules
    if (!line || /^([!#>|]|[-+*]\s|-{3,}|\d+\.\s)/.test(line)) continue;
    const m = line.match(new RegExp(`^(.{4,${MAX}}?${SENTENCE_END.source})`));
    if (m) return m[1];
    return line.length > MAX - 2 ? line.slice(0, MAX - 2) + "…" : line;
  }
  return fallback;
}

/** Tags from the filename: YYYY-year is a yearly summary, YYYY-MM a monthly. */
function inferTags(slug) {
  if (/^\d{4}-year$/.test(slug)) return ["summaries", "year"];
  if (/^\d{4}-\d{2}$/.test(slug)) return ["summaries", "month"];
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
