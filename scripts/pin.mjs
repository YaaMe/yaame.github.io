#!/usr/bin/env node
/**
 * Pin a post, or unpin it.
 *
 *   make pin 2025-year
 *   make unpin 2025-year
 *
 * Edits one line of the frontmatter. **No YAML round-trip**: that would reorder
 * and requote the whole block to a library's taste, and the order, blank lines
 * and quoting there are deliberate.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const remove = args[0] === "--remove";
const slug = args.slice(remove ? 1 : 0).join("").trim();

if (!slug) {
  console.error("  用法：make pin <slug>   /   make unpin <slug>");
  process.exit(1);
}

const file = `src/content/posts/${slug}.md`;
if (!existsSync(file)) {
  console.error(`  没有这篇：${file}`);
  process.exit(1);
}

const text = readFileSync(file, "utf8");
const end = text.indexOf("\n---", 4);
if (!text.startsWith("---\n") || end < 0) {
  console.error(`  ${file} 没有 frontmatter`);
  process.exit(1);
}

const head = text.slice(4, end).split("\n");
const body = text.slice(end + 1);
const at = head.findIndex((line) => /^pinned\s*:/.test(line));

if (remove) {
  if (at < 0) {
    console.log(`  本来就没置顶：${slug}`);
    process.exit(0);
  }
  head.splice(at, 1);
} else {
  if (at >= 0) {
    head[at] = "pinned: true";
  } else {
    // After the title: this is a fact about the post itself, not something to
    // sit among the tags or the description.
    const title = head.findIndex((line) => /^title\s*:/.test(line));
    head.splice(title < 0 ? head.length : title + 1, 0, "pinned: true");
  }
}

writeFileSync(file, `---\n${head.join("\n")}\n${body}`);
console.log(`  ${remove ? "取消置顶" : "置顶"}：${slug}`);
console.log("\n  提交并部署之后，别人搜到这个账号就能看到它。");
