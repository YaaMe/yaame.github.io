#!/usr/bin/env node
/**
 * Put `routes` back into the config the adapter generates.
 *
 * @astrojs/cloudflare rewrites wrangler.jsonc into dist/server/wrangler.json
 * and drops `routes` on the way. The deploy still succeeds; the custom domains
 * are simply never created.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "wrangler.jsonc";
const OUT = "dist/server/wrangler.json";

const routes = JSON.parse(readFileSync(SRC, "utf8").replace(/^\s*\/\/.*$/gm, "")).routes;
if (!routes?.length) {
  console.error("  wrangler.jsonc 里没有 routes");
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(OUT, "utf8"));
cfg.routes = routes;
writeFileSync(OUT, JSON.stringify(cfg, null, 2));
console.log(`  routes 补回 ${OUT}：${routes.map((r) => r.pattern).join(", ")}`);
