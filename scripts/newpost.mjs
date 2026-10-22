#!/usr/bin/env node
/**
 * Create a post, with the filename and tags following from its kind.
 *
 *   node scripts/newpost.mjs              last month's summary (the common case,
 *                                         since summaries are written after)
 *   node scripts/newpost.mjs 2026-09      a given month
 *   node scripts/newpost.mjs 2026-year    a year
 *   node scripts/newpost.mjs 2026-09-15   an essay; tags left to you
 *   node scripts/newpost.mjs 2026-09-15 --title "标题"
 *   node scripts/newpost.mjs 2026-09-15 --no-interactive   skip tag selection
 *   node scripts/newpost.mjs 2026-09-15 --pick             force the selector
 *
 * No `description` is written: run `make fix` once the body exists, or write a
 * better one by hand.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { posts, tags as tagsLocation } from "../src/config/data.config.generated.mjs";
import { preparePost, postStamp } from "../src/services/authoring/posts.ts";
import { readTags, validTagInput, prepareTagAddition } from "../src/services/authoring/tags.ts";

const POOL = readTags(readFileSync(tagsLocation.file, "utf8"));

const DIR = posts.gitRoot;

const args = process.argv.slice(2);

const USAGE = [
  "  用法：node scripts/newpost.mjs [日期] [选项]",
  "",
  "    （不带参数）      上一个月的月结",
  "    2026-09           指定月结",
  "    2026-year         年结",
  "    2026-09-15        单篇随笔",
  "",
  "    --title <标题>    指定标题，默认用日期",
  "    --no-interactive  跳过标签选择",
  "    --pick            强制进入选择器（不依赖 TTY）",
  "    -h, --help        显示这段",
].join("\n");

// An unknown flag or an extra argument is an error. Ignoring it would fall
// through to the default, and a typo would write last month's summary.
let title = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-h" || a === "--help") {
    console.log(USAGE);
    process.exit(0);
  } else if (a === "--title") {
    const v = args[++i];
    if (v === undefined || v.startsWith("--")) {
      console.error("  --title 后面要跟一个标题");
      process.exit(2);
    }
    title = v;
  } else if (a === "--no-interactive" || a === "--pick") {
    // Read further down, where the picker decides whether to run.
  } else if (a.startsWith("-")) {
    console.error(`  未知参数 ${a}\n`);
    console.error(USAGE);
    process.exit(2);
  } else {
    rest.push(a);
  }
}
if (rest.length > 1) {
  console.error(`  只接受一个日期参数，收到 ${rest.length} 个：${rest.join(" ")}`);
  process.exit(2);
}
const k = preparePost(rest[0], new Date(), title);
const spec = k?.spec ?? rest[0];
if (!k) {
  console.error(`  认不出 "${spec}"。可用形式：2026-year / 2026-09 / 2026-09-15`);
  process.exit(2);
}

const path = join(DIR, `${spec}.md`);
if (existsSync(path)) {
  console.error(`  ${path} 已存在 —— 不覆盖`);
  process.exit(1);
}

const stamp = postStamp(new Date());

// A summary's tags follow from its name. An essay's are chosen interactively,
// which is what keeps a typo out of the registry.
let tags = k.tags;
// --pick forces the selector without a TTY, for tests and debugging
if (!tags.length && (process.stdin.isTTY || args.includes("--pick")) && !args.includes("--no-interactive")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl+C interrupts before the file is written: no half-created post
  const abort = () => { console.log("\n  取消，未创建任何文件"); process.exit(130); };
  process.on("SIGINT", abort);
  rl.on("SIGINT", abort);
  console.log("  可用标签：");
  POOL.forEach((t, i) => console.log(`    ${i + 1}. ${t.slug.padEnd(16)} ${t.label}`));
  console.log("    n. 新建一个标签");
  console.log("    q. 取消");
  const ans = (await rl.question("  选（空格分隔序号，n 新建，q 取消，回车跳过）: ")).trim();
  if (ans === "q" || ans === "Q") abort();

  const picked = [];
  for (const tok of ans.split(/\s+/).filter(Boolean)) {
    if (tok === "n") {
      // The registry is still the only truth; this only saves a trip to edit it
      const slug = (await rl.question("    新标签的英文 slug: ")).trim();
      const zh = (await rl.question("    显示名（中文）: ")).trim();
      const addition = validTagInput(slug, zh, "interactive")
        ? prepareTagAddition(readFileSync(tagsLocation.file, "utf8"), slug, zh, "interactive")
        : { status: "invalid" };
      if (addition.status === "write") {
        writeFileSync(tagsLocation.file, addition.document);
        picked.push(slug);
        console.log(`    已写入 ${tagsLocation.file}：${slug} → ${zh}`);
      } else {
        console.log("    slug 只能是字母数字下划线，且显示名不能为空 —— 跳过");
      }
    } else {
      const t = POOL[Number(tok) - 1]?.slug;
      if (t) picked.push(t);
    }
  }
  rl.close();
  tags = [...new Set(picked)];
}

let fm = `---\ntitle: "${k.title}"\ndate: ${stamp}\n`;
fm += tags.length
  ? `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}\n`
  : `tags:\n  # 从 ${tagsLocation.file} 的常量池里选；不在池子里的会让构建失败\n`;
fm += `---\n\n`;

writeFileSync(path, fm);
console.log(`  ${path}   （${k.kind}${tags.length ? `，标签 ${tags.join(" ")}` : "，标签待填"}）`);
console.log(`  写完正文后跑 make fix 补 description`);
