#!/usr/bin/env node
/**
 * Generate wrangler.jsonc from wrangler.jsonc.template.
 *
 * `${VAR}` is replaced by the environment variable of the same name. The
 * adapter reads wrangler.jsonc during the build, so this must run before
 * `astro build`.
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
