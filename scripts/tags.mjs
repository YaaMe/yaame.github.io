#!/usr/bin/env node
/** The tag registry, with how many posts use each one. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { komorebi, posts, tags } from "../src/config/data.config.generated.mjs";
import { readTags, tagUsage } from "../src/services/authoring/tags.ts";

const pool = readTags(readFileSync(tags.file, "utf8"));
const documents = [];
for (const dir of [posts.gitRoot, komorebi.gitRoot]) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    documents.push(readFileSync(join(dir, f), "utf8"));
  }
}
const { used, orphan } = tagUsage(documents, pool);

console.log(`  ${"slug".padEnd(18)}${"显示名".padEnd(12)}用量`);
for (const t of pool) {
  const n = used.get(t.slug) ?? 0;
  console.log(`  ${t.slug.padEnd(18)}${t.label.padEnd(10)}${String(n).padStart(4)}${n ? "" : "   ← 未使用"}`);
}
if (orphan.length) console.log(`\n  ★ 不在池子里（构建会失败）：${orphan.join(" ")}`);
