#!/usr/bin/env node
/**
 * 从 wrangler.jsonc.template 生成 wrangler.jsonc。
 *
 * 模板里的 ${VAR} 用同名环境变量替换。adapter 在构建期就要读 wrangler.jsonc，
 * 所以这一步必须在 astro build 之前跑。
 */
import { readFileSync, writeFileSync } from "node:fs";

const [template = "wrangler.jsonc.template", out = "wrangler.jsonc"] = process.argv.slice(2);
const src = readFileSync(template, "utf8");
const missing = [];
const result = src.replace(/\$\{(\w+)\}/g, (_, name) => {
  const v = process.env[name];
  if (!v) missing.push(name);
  return v ?? "";
});

if (missing.length) {
  console.error(`  缺少环境变量：${[...new Set(missing)].join(", ")}`);
  process.exit(1);
}
writeFileSync(out, result);
console.log(`  ${out} 已生成`);
