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
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { posts } from "../src/config/data.config.generated.mjs";
import { prepareFrontmatter } from "../src/services/authoring/posts.ts";

const DIR = posts.gitRoot;
const argv = new Set(process.argv.slice(2));
const dry = argv.has("--dry-run");
const check = argv.has("--check");
const force = argv.has("--force");

let changed = 0, missing = 0;
for (const name of readdirSync(DIR).filter((f) => f.endsWith(".md")).sort()) {
  const path = join(DIR, name);
  const slug = name.replace(/\.md$/, "");
  const src = readFileSync(path, "utf8");
  const result = prepareFrontmatter(src, slug, force);
  if (result.status === "no-frontmatter") { console.warn(`  跳过 ${name}：没有 frontmatter`); continue; }
  if (result.missingTags) {
    missing++;
    console.log(`  ? ${name} 缺 tags，文件名认不出类型 —— 需要人工`);
  }
  if (result.changed) {
    changed++;
    console.log(`  ${dry || check ? "会改" : "已改"} ${name}`);
    if (!dry && !check) writeFileSync(path, result.document);
  }
}

console.log(`\n  ${changed} 个文件需要补全，${missing} 个需要人工处理`);
if (check && (changed || missing)) {
  console.error("  --check：有未补全的 frontmatter");
  process.exit(1);
}
