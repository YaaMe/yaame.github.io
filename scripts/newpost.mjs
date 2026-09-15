#!/usr/bin/env node
/**
 * 新建一篇文章，文件名和标签按类型自动推断。
 *
 *   node scripts/newpost.mjs              上一个月的月结（最常用，小结都是事后写的）
 *   node scripts/newpost.mjs 2026-09      指定月结
 *   node scripts/newpost.mjs 2026-year    年结
 *   node scripts/newpost.mjs 2026-09-15   单篇随笔（标签留空，由你决定）
 *   node scripts/newpost.mjs 2026-09-15 --title "标题"
 *   node scripts/newpost.mjs 2026-09-15 --no-interactive   跳过标签选择
 *   node scripts/newpost.mjs 2026-09-15 --pick              强制进入选择器（测试用）
 *
 * 不写 description —— 正文写完之后跑 `make fix` 补，或者自己写一句更好的。
 */
import { existsSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";

// 标签从 src/tags.ts 的常量池读 —— 只有一份真相。
// 不引 TS 编译器，直接从源码里抠出键名。
const POOL = [...readFileSync("src/tags.ts", "utf8")
  .matchAll(/^\s{2}(\w+):\s*"([^"]+)"/gm)].map((m) => ({ slug: m[1], label: m[2] }));

const DIR = "src/content/posts";
const TZ = "+08:00";

const args = process.argv.slice(2);
const ti = args.indexOf("--title");
const title = ti >= 0 ? args[ti + 1] : null;
const spec = args.find((a) => !a.startsWith("--") && a !== title) ?? lastMonth();

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 往常量池里追加一条。插在 `} as const;` 之前，保持文件结构。 */
function addToPool(slug, zh) {
  const f = "src/tags.ts";
  const src = readFileSync(f, "utf8");
  writeFileSync(f, src.replace(/\n\} as const;/, `\n  ${slug}: "${zh}",\n} as const;`));
}

function kindOf(s) {
  if (/^\d{4}-year$/.test(s)) return { kind: "year", tags: ["summaries", "year"] };
  if (/^\d{4}-\d{2}$/.test(s)) return { kind: "month", tags: ["summaries", "month"] };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { kind: "post", tags: [] };
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

// 发布时间取此刻。小结的身份是文件名里的时段，这个只是元数据。
const n = new Date();
const p = (x) => String(x).padStart(2, "0");
const stamp =
  `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ` +
  `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}${TZ}`;

// 小结的标签能推断出来；单篇随笔交互式选，避免手打拼错。
let tags = k.tags;
// --pick 强制进入选择器（不依赖 TTY），供测试和调试用
if (!tags.length && (process.stdin.isTTY || args.includes("--pick")) && !args.includes("--no-interactive")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl+C 在写文件之前中断 —— 不会留下半截文章
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
      // 池子仍是唯一真相，只是加一条不必切出去改代码
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
