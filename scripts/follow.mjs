#!/usr/bin/env node
/**
 * Follow someone, or stop.
 *
 *   make follow @someone@example.com
 *   make unfollow @someone@example.com
 *
 * Writes the intent and sends nothing. The Follow itself goes out from the
 * Worker after the next deploy, because signing needs the key and the terminal
 * does not have it.
 *
 * Who we follow is ours, so it lives in git; who follows us arrives from
 * outside, so it lives in KV. See
 * docs/decisions/0004-follow-reconciliation-pivots-on-what-was-sent.md.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/integrations/activitypub/following.json";
// `--remove` rather than a leading `-` on the handle: make reads a leading
// dash as one of its own options, and the command never arrives here.
const args = process.argv.slice(2);
const remove = args[0] === "--remove";
const handle = args.slice(remove ? 1 : 0).join("").trim().replace(/^@/, "");

if (!handle) {
  console.error("  用法：make follow @someone@example.com   /   make unfollow @someone@example.com");
  process.exit(1);
}

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(handle)) {
  console.error(`  不像一个 handle：${handle}`);
  process.exit(1);
}

const doc = JSON.parse(readFileSync(FILE, "utf8"));
const had = doc.follow.includes(handle);

if (remove) {
  if (!had) {
    console.log(`  本来就没关注 ${handle}`);
    process.exit(0);
  }
  doc.follow = doc.follow.filter((h) => h !== handle);
} else {
  if (had) {
    console.log(`  已经在名单里了：${handle}`);
    process.exit(0);
  }
  doc.follow.push(handle);
  doc.follow.sort();
}

writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`  ${remove ? "移出" : "写入"} ${FILE}：${handle}`);
console.log("\n  提交并部署之后运行时会对账，真正发出 Follow。");
