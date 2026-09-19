#!/usr/bin/env node
/**
 * Add an entry to the tag registry in src/tags.ts.
 *
 *   node scripts/newtag.mjs reading 读书
 *
 * The registry is the only truth: a tag that is not in it fails the build.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [slug, label] = process.argv.slice(2);
const FILE = "src/tags.ts";

if (!slug || !label) {
  console.error("  用法: make newtag SLUG=<英文标识> LABEL=<显示名>");
  process.exit(2);
}
if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
  console.error(`  slug "${slug}" 不合法：小写字母开头，只能含小写字母、数字、下划线`);
  process.exit(2);
}

const src = readFileSync(FILE, "utf8");
if (new RegExp(`^\\s{2}${slug}:`, "m").test(src)) {
  console.error(`  "${slug}" 已在池子里 —— 用 make tags 看现有的`);
  process.exit(1);
}

writeFileSync(FILE, src.replace(/\n\} as const;/, `\n  ${slug}: "${label}",\n} as const;`));
console.log(`  已加入 ${FILE}：${slug} → ${label}`);
console.log(`  现在可以在 frontmatter 里用它了；make tags 看全部`);
