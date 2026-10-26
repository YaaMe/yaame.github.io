#!/usr/bin/env node
// The adapter reads wrangler.jsonc during the build, so this must run before
// `astro build`.
import { readFileSync, writeFileSync } from "node:fs";
import { resourceNames } from "./resource-names.mjs";

const [template = "wrangler.jsonc.template", out = "wrangler.jsonc"] = process.argv.slice(2);
const src = readFileSync(template, "utf8");
const missing = [];
const result = src.replace(/\$\{(\w+)\}|\{\{(\w+)\}\}/g, (_, name, resource) => {
  if (resource) {
    if (!Object.hasOwn(resourceNames, resource)) throw new Error(`Unknown resource name: ${resource}`);
    return JSON.stringify(resourceNames[resource]).slice(1, -1);
  }
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
