#!/usr/bin/env node
/**
 * 从 wrangler.jsonc.template 生成 wrangler.jsonc。
 *
 * 模板里的 ${VAR} 用同名环境变量替换。adapter 在构建期就要读 wrangler.jsonc，
 * 所以这一步必须在 astro build 之前跑。
 */
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("wrangler.jsonc.template", "utf8");
const missing = [];
const out = src.replace(/\$\{(\w+)\}/g, (_, name) => {
  const v = process.env[name];
  if (!v) missing.push(name);
  return v ?? "";
});

if (missing.length) {
  console.error(`  缺少环境变量：${[...new Set(missing)].join(", ")}`);
  process.exit(1);
}
writeFileSync("wrangler.jsonc", out);
console.log("  wrangler.jsonc 已生成");
