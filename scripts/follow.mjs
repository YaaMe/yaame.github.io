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
import { followIntentLocation } from "../src/config/data.config.generated.mjs";
import { validFollowHandle, prepareFollowIntent } from "../src/services/authoring/following.ts";

const FILE = followIntentLocation.file;
// `--remove` rather than a leading `-` on the handle: make reads a leading
// dash as one of its own options, and the command never arrives here.
const args = process.argv.slice(2);
const remove = args[0] === "--remove";
const handle = args.slice(remove ? 1 : 0).join("").trim().replace(/^@/, "");

if (!handle) {
  console.error("  用法：make follow @someone@example.com   /   make unfollow @someone@example.com");
  process.exit(1);
}

if (!validFollowHandle(handle)) {
  console.error(`  不像一个 handle：${handle}`);
  process.exit(1);
}

const result = prepareFollowIntent(readFileSync(FILE, "utf8"), handle, remove);
if (result.status === "absent") {
  console.log(`  本来就没关注 ${handle}`);
  process.exit(0);
}
if (result.status === "present") {
  console.log(`  已经在名单里了：${handle}`);
  process.exit(0);
}
writeFileSync(FILE, result.document);
console.log(`  ${remove ? "移出" : "写入"} ${FILE}：${handle}`);
console.log("\n  提交并部署之后运行时会对账，真正发出 Follow。");
