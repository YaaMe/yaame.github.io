#!/usr/bin/env node
/**
 * Pin a post, or unpin it.
 *
 *   make pin 2025-year
 *   make unpin 2025-year
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { postsPinned } from "../src/config/data.config.generated.mjs";
import { pinPost } from "../src/services/authoring/posts.ts";

const args = process.argv.slice(2);
const remove = args[0] === "--remove";
const slug = args.slice(remove ? 1 : 0).join("").trim();

if (!slug) {
  console.error("  用法：make pin <slug>   /   make unpin <slug>");
  process.exit(1);
}

const file = join(postsPinned.gitRoot, `${slug}.md`);
if (!existsSync(file)) {
  console.error(`  没有这篇：${file}`);
  process.exit(1);
}

const text = readFileSync(file, "utf8");
const result = pinPost(text, remove);
if (result.status === "no-frontmatter") {
  console.error(`  ${file} 没有 frontmatter`);
  process.exit(1);
}
if (result.status === "unchanged") {
  console.log(`  本来就没置顶：${slug}`);
  process.exit(0);
}
writeFileSync(file, result.document);
console.log(`  ${remove ? "取消置顶" : "置顶"}：${slug}`);
console.log("\n  提交并部署之后，别人搜到这个账号就能看到它。");
