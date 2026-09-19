#!/usr/bin/env node
/**
 * 关注一个人,或取消关注。
 *
 *   make follow @someone@example.com
 *   make follow -@someone@example.com    前面加减号表示取关
 *
 * 只写配置,不发任何东西。真正的 Follow 由 Worker 发出 —— 签名只能在那里发生,
 * 而终端没有密钥(这是有意的)。
 *
 * 所以这里写的是**意图**:部署之后运行时会对账,git 里有而实际没关注的就发一条
 * Follow,git 里没有而实际关注着的就发 Undo。和评论那套是同一个形状 ——
 * 关注谁是我们自己的意思,该在 git 里;谁关注我们是外来的,在 KV 里。
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/integrations/activitypub/following.json";
const arg = process.argv.slice(2).join("").trim();

if (!arg) {
  console.error("  用法：make follow @someone@example.com   （前面加 - 表示取关）");
  process.exit(1);
}

const remove = arg.startsWith("-");
const handle = arg.replace(/^-/, "").replace(/^@/, "");

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(handle)) {
  console.error(`  不像一个 handle：${handle}`);
  process.exit(1);
}

const doc = JSON.parse(readFileSync(FILE, "utf8"));
const had = doc.follow.includes(handle);

if (remove) {
  if (!had) {
    console.log(`  本来就没关注 ${handle}`);
    process.exit(0);
  }
  doc.follow = doc.follow.filter((h) => h !== handle);
} else {
  if (had) {
    console.log(`  已经在名单里了：${handle}`);
    process.exit(0);
  }
  doc.follow.push(handle);
  doc.follow.sort();
}

writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`  ${remove ? "移出" : "写入"} ${FILE}：${handle}`);
console.log("\n  提交并部署之后运行时会对账，真正发出 Follow。");
