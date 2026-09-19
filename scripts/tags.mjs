#!/usr/bin/env node
/** The tag registry, with how many posts use each one. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const pool = [...readFileSync("src/tags.ts", "utf8")
  .matchAll(/^\s{2}(\w+):\s*"([^"]+)"/gm)].map((m) => ({ slug: m[1], label: m[2] }));

const used = new Map();
for (const dir of ["src/content/posts", "src/content/komorebi"]) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const fm = readFileSync(join(dir, f), "utf8").split("---")[1] ?? "";
    // Items under `tags:` only: list items beneath any other field would
    // otherwise be counted as tags.
    const block = fm.match(/^tags:\s*\n((?:\s+-\s*\w+\s*\n)+)/m);
    if (!block) continue;
    for (const m of block[1].matchAll(/-\s*(\w+)/g)) {
      used.set(m[1], (used.get(m[1]) ?? 0) + 1);
    }
  }
}

console.log(`  ${"slug".padEnd(18)}${"显示名".padEnd(12)}用量`);
for (const t of pool) {
  const n = used.get(t.slug) ?? 0;
  console.log(`  ${t.slug.padEnd(18)}${t.label.padEnd(10)}${String(n).padStart(4)}${n ? "" : "   ← 未使用"}`);
}
const orphan = [...used.keys()].filter((k) => !pool.some((t) => t.slug === k));
if (orphan.length) console.log(`\n  ★ 不在池子里（构建会失败）：${orphan.join(" ")}`);
