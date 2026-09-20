#!/usr/bin/env node
/**
 * Check that every internal link in the build output resolves.
 *
 * The two shapes it catches: a missing trailing slash, which is a 404 under
 * `trailingSlash: "always"`, and a path declared in a layout that nothing
 * generates.
 *
 * A dynamic route leaves no file, so without the manifest the build writes it
 * would be indistinguishable from a typo. Those are counted, not checked —
 * whether the Worker answers is a question for the conformance check against
 * a deployment, not for a directory listing.
 *
 *   node scripts/check-links.mjs [output directory]
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

// With an adapter installed the static output is under dist/client/ and the
// server code under dist/server/.
const DIST = process.argv[2] ?? "dist/client";

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

// Written by the dynamic-routes integration. Absent when the profile
// prerendered everything, which makes the empty list correct rather than a
// silent pass.
const manifest = join(DIST, "dynamic-routes.json");
const dynamic = existsSync(manifest)
  ? JSON.parse(readFileSync(manifest, "utf8")).map((p) => new RegExp(p))
  : [];

const files = walk(DIST);
const pages = new Set(
  files.filter((f) => f.endsWith("index.html"))
    .map((f) => "/" + relative(DIST, f).replace(/index\.html$/, "")),
);

const bad = [];
const served = new Set();
let total = 0;
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const from = "/" + relative(DIST, f);
  for (const m of readFileSync(f, "utf8").matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    const url = m[1].split(/[?#]/)[0];
    total++;
    const ok = url.endsWith("/")
      ? pages.has(url)
      : existsSync(join(DIST, url));
    if (ok) continue;
    if (dynamic.some((re) => re.test(url))) {
      served.add(url);
      continue;
    }
    bad.push(`${url}   ← 来自 ${from}`);
  }
}

const uniq = [...new Set(bad)];
if (uniq.length) {
  console.error(`  ✗ ${uniq.length} 条死链：`);
  uniq.forEach((b) => console.error(`      ${b}`));
  process.exit(1);
}
const byWorker = served.size > 0 ? `，另有 ${served.size} 条由 Worker 应答` : "";
console.log(`  ✓ ${total} 条内部链接全部可达（${pages.size} 个页面）${byWorker}`);
for (const u of served) console.log(`      ${u}`);
