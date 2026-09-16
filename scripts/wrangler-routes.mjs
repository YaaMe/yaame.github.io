#!/usr/bin/env node
/**
 * 把 routes 补回 adapter 生成的配置。
 *
 * @astrojs/cloudflare 会把 wrangler.jsonc 重写成 dist/server/wrangler.json，
 * 路上丢掉 routes —— 部署照常成功，只是自定义域从未被创建。构建后补一次。
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
