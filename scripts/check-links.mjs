#!/usr/bin/env node
/**
 * 检查构建产物里的内部链接是否全部可达。
 *
 * 抓到过两类真 bug：
 *   - 少写尾斜杠（trailingSlash: "always" 下会 404）
 *   - Base.astro 里声明了 /rss.xml 但没生成
 *
 *   node scripts/check-links.mjs [dist目录]
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = process.argv[2] ?? "dist";

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`  ${DIST} 不存在 —— 先 make build`);
  process.exit(1);
}

const files = walk(DIST);
const pages = new Set(
  files.filter((f) => f.endsWith("index.html"))
    .map((f) => "/" + relative(DIST, f).replace(/index\.html$/, "")),
);

const bad = [];
let total = 0;
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const from = "/" + relative(DIST, f);
  for (const m of readFileSync(f, "utf8").matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const url = m[1].split(/[?#]/)[0];
    total++;
    const ok = url.endsWith("/")
      ? pages.has(url)
      : existsSync(join(DIST, url));
    if (!ok) bad.push(`${url}   ← 来自 ${from}`);
  }
}

const uniq = [...new Set(bad)];
if (uniq.length) {
  console.error(`  ✗ ${uniq.length} 条死链：`);
  uniq.forEach((b) => console.error(`      ${b}`));
  process.exit(1);
}
console.log(`  ✓ ${total} 条内部链接全部可达（${pages.size} 个页面）`);
