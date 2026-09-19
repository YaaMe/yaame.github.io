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

// Tags come from the registry in src/tags.ts, which is the only truth. The key
// names are read out of the source rather than pulling in a TypeScript compiler.
const POOL = [...readFileSync("src/tags.ts", "utf8")
  .matchAll(/^\s{2}(\w+):\s*"([^"]+)"/gm)].map((m) => ({ slug: m[1], label: m[2] }));

const DIR = "src/content/posts";
const TZ = "+08:00";

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

// Parsed explicitly, because the loose version silently ignored anything it did
// not recognise and then fell through to its default — so a typo, or a --help
// this script never had, wrote last month's summary instead of complaining.
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
const spec = rest[0] ?? lastMonth();

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Append to the registry, before `} as const;` so the structure holds. */
function addToPool(slug, zh) {
  const f = "src/tags.ts";
  const src = readFileSync(f, "utf8");
  writeFileSync(f, src.replace(/\n\} as const;/, `\n  ${slug}: "${zh}",\n} as const;`));
}

/** A real calendar day, so 2026-02-30 is rejected rather than filed. */
function isRealDay(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Month and day are range-checked, not just shape-checked: \d{2} accepted
// month 99, and the file was written before anything noticed.
function kindOf(s) {
  if (/^\d{4}-year$/.test(s)) return { kind: "year", tags: ["summaries", "year"] };

  let m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? { kind: "month", tags: ["summaries", "month"] } : null;
  }

  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    return isRealDay(Number(m[1]), Number(m[2]), Number(m[3]))
      ? { kind: "post", tags: [] }
      : null;
  }

  return null;
}

const k = kindOf(spec);
if (!k) {
  console.error(`  认不出 "${spec}"。可用形式：2026-year / 2026-09 / 2026-09-15`);
  process.exit(2);
}

const path = join(DIR, `${spec}.md`);
if (existsSync(path)) {
  console.error(`  ${path} 已存在 —— 不覆盖`);
  process.exit(1);
}

// Published now. A summary's identity is the period in its filename, so this
// is metadata and nothing more.
const n = new Date();
const p = (x) => String(x).padStart(2, "0");
const stamp =
  `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ` +
  `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}${TZ}`;

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
      if (/^\w+$/.test(slug) && zh) {
        addToPool(slug, zh);
        picked.push(slug);
        console.log(`    已写入 src/tags.ts：${slug} → ${zh}`);
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

let fm = `---\ntitle: "${title ?? spec}"\ndate: ${stamp}\n`;
fm += tags.length
  ? `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}\n`
  : `tags:\n  # 从 src/tags.ts 的常量池里选；不在池子里的会让构建失败\n`;
fm += `---\n\n`;

writeFileSync(path, fm);
console.log(`  ${path}   （${k.kind}${tags.length ? `，标签 ${tags.join(" ")}` : "，标签待填"}）`);
console.log(`  写完正文后跑 make fix 补 description`);
