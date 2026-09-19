#!/usr/bin/env node
/**
 * Interactive entry point: asks what to create, then hands off.
 *
 *   make new          here
 *   make newpost P=…  straight to a post
 *   make newtag  …    straight to a tag
 *
 * Dispatch only, no creation logic, so both routes reach one implementation.
 */
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";

if (!process.stdin.isTTY) {
  console.error("  make new 需要交互式终端。非交互场景用 make newpost / make newtag");
  process.exit(2);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

// Ctrl+C / Ctrl+D exit cleanly: no half-written file, no stack trace. 130 is
// the conventional exit code for SIGINT.
const abort = () => { console.log("\n  取消"); process.exit(130); };
process.on("SIGINT", abort);
rl.on("SIGINT", abort);
rl.on("close", () => {});
/** Read one line; `q` cancels. */
const ask = async (q) => {
  const a = (await rl.question(q)).trim();
  if (a === "q" || a === "Q") abort();
  return a;
};
const run = (script, args) => {
  rl.close();
  const r = spawnSync(process.execPath, [`scripts/${script}`, ...args], { stdio: "inherit" });
  process.exit(r.status ?? 0);
};

console.log("  新建什么？");
console.log("    1. 文章");
console.log("    2. 标签");
console.log("    q. 退出");
const what = await ask("  选: ");

if (what === "1") {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const lastMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  console.log(`\n  时段：2026-year 年结 / 2026-09 月结 / 2026-09-15 单篇`);
  const spec = (await ask(`  时段（回车=${lastMonth}，q 退出）: `)) || lastMonth;
  const title = await ask("  标题（回车=同时段）: ");
  run("newpost.mjs", title ? [spec, "--title", title] : [spec]);
} else if (what === "2") {
  const slug = await ask("  英文 slug: ");
  const label = await ask("  显示名: ");
  run("newtag.mjs", [slug, label]);
} else {
  console.log("  取消");
  rl.close();
}
