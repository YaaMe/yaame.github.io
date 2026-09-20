#!/usr/bin/env node
/**
 * Write a note.
 *
 *   make po test
 *   make po 今天读完了这本书 https://example.com
 *   make po T="use this when the text holds # or $"
 *   make po F=draft.md              show what a file would become
 *   make po F=draft.md APPLY=1      write it, and remove the draft
 *
 * Appended to src/content/notes/<year>.json. The body is read as markdown:
 * plain text is valid markdown, and an unparsed link shows as a bare URL.
 *
 * `F=` is for the draft that was easier to start in an editor than on a
 * command line. Frontmatter is optional — with it, `date` becomes the note's
 * time while `title`, `tags` and `pinned` are dropped, because a note has
 * nowhere to put them. It defaults to a dry run because it removes the file it
 * read, and a draft is usually not in git to recover from.
 *
 * This is the terminal half of publishing — straight into git, visible after a
 * commit and a deploy. The other half writes D1 from the routing layer, is
 * federated at once, and is promoted back into git afterwards. Both land in the
 * same place.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { append, newId, yearOf } from "./notes-store.mjs";

const APPLY = process.env.APPLY === "1";
const FORCE = process.env.FORCE === "1";

const argv = process.argv.slice(2);
const at = argv.indexOf("--file");
const source = at >= 0 ? argv[at + 1] : null;
const text = (at >= 0 ? argv.slice(0, at) : argv).join(" ").trim();

const fail = (...lines) => {
  for (const l of lines) console.error(l);
  process.exit(1);
};

if (!source && !text) {
  fail('  用法：make po 正文    /    make po T="正文"    /    make po F=draft.md');
}

/**
 * A note from a file.
 *
 * Returns what to write and what is being given up, and refuses rather than
 * strand an address: a file that is already a published post has an
 * ActivityPub id in the followers' databases, and a note gets a new random one.
 * The old address would 404 with remote servers still pointing at it, and the
 * content would arrive again as something new. The protocol's answer is a
 * `Delete`, which needs the signing key, which is deliberately not here.
 */
async function fromFile(path) {
  // A path if one exists, a slug otherwise. The draft this is for usually lives
  // wherever it was convenient to write it, not in the content directory.
  const asPost = `src/content/posts/${path}.md`;
  const file = existsSync(path) ? path : asPost;
  if (!existsSync(file)) fail(`  没有这个文件：${path}`, `  也不是 ${asPost}`);

  // Only a file that is already a post can have been federated, and only then
  // is there an id to strand.
  const slug = file === asPost ? path : null;

  const raw = readFileSync(file, "utf8");
  let head = "";
  let body = raw.trim();
  if (raw.startsWith("---\n")) {
    const end = raw.indexOf("\n---", 4);
    if (end < 0) fail(`  ${file} 的 frontmatter 没有收尾`);
    head = raw.slice(4, end);
    body = raw.slice(end + 4).trim();
  }
  if (!body) fail(`  ${file} 没有正文`);

  const value = (n) => head.match(new RegExp(`^${n}\\s*:\\s*(.+)$`, "m"))?.[1]?.trim();

  /** `tags: [a, b]` and a `- ` list under `tags:` are both in use. */
  const tags = (() => {
    const inline = value("tags");
    if (inline?.startsWith("[")) return inline.slice(1, -1).split(",").map((t) => t.trim());
    const block = head.match(/^tags\s*:\s*\n((?:\s*-\s*.+\n?)+)/m);
    return block ? block[1].trim().split("\n").map((l) => l.replace(/^\s*-\s*/, "")) : [];
  })();

  const written = value("date")?.replace(/^["']|["']$/g, "");
  const when = written ? new Date(written) : new Date();
  if (Number.isNaN(when.getTime())) fail(`  date 读不成时间：${written}`);

  if (slug) {
    // Promoted comments hang off the post's ActivityPub id. Converting would
    // leave them describing a conversation under an object that no longer
    // answers, and nothing would report it.
    const comments = `src/content/comments/posts/${slug}.json`;
    if (existsSync(comments)) {
      fail(
        `\n  ✗ ${comments} 存在：有评论挂在这篇的 AP id 上`,
        "    转换会让它们指向一个不再应答的对象。先决定那些评论怎么办。",
      );
    }

    // Read out of the source rather than importing it: config.ts is TypeScript,
    // and pulling in a compiler to learn two strings costs more than this.
    const config = readFileSync("src/integrations/activitypub/config.ts", "utf8");
    const field = (n) => config.match(new RegExp(`${n}:\\s*"([^"]+)"`))?.[1];
    const host = field("actorHost");
    const user = field("user");
    if (!host || !user) fail("  读不出 actorHost / user —— config.ts 的形状变了，先看一眼再跑");

    const address = `https://${host}/users/${user}/notes/${slug}`;
    let live = false;
    try {
      live = (await fetch(address, { headers: { accept: "application/activity+json" } })).status === 200;
    } catch {
      // Unreachable is not "not published", and treating it as one is the
      // single thing that must not happen here.
      fail(
        `\n  ✗ 查不到 ${address} 是否已发布（网络问题？）`,
        "    这一步查不出来就该失败，而不是当作没发布过。",
      );
    }
    if (live && !FORCE) {
      fail(
        `\n  ✗ 这篇已经联邦化了：${address}`,
        "    它的 id 在关注者的数据库里。转成短文会换成新 id，旧地址变 404，",
        "    而按协议该发的 Delete 这里发不出来（没有签名密钥，这是有意的）。",
        "\n    真要转：FORCE=1，代价如上。",
      );
    }
    if (live) console.error("\n  ⚠ FORCE=1：旧 id 会变成 404，远端引用悬空。");
  }

  return { file, body, when, dated: Boolean(written), title: value("title"), tags, pinned: Boolean(value("pinned")) };
}

const from = source ? await fromFile(source) : { body: text, when: new Date(), dated: true };

// Normalised to UTC, because `allNotes()` orders by comparing these strings and
// a mix of `Z` and `+08:00` does not compare: 09:00+08:00 sorts after 02:00Z
// while being an hour earlier. The outbox is an OrderedCollection, so the order
// is the specification's business rather than a presentation choice.
const published = from.when.toISOString().replace(/\.\d{3}Z$/, "Z");
const year = yearOf(from.when);
const id = newId();

if (source) {
  console.log(`  ${from.file}`);
  console.log(`    → src/content/notes/${year}.json   id ${id}   ${published}`);
  if (!from.dated) console.log("    （没有 date，用此刻）");
  if (from.title) console.log(`\n  丢掉标题：${from.title.replace(/^["']|["']$/g, "")}`);
  if (from.tags.length > 0) console.log(`  丢掉标签：${from.tags.join("、")}`);
  if (from.pinned) console.log("  丢掉置顶");
  console.log(`\n  正文（${from.body.length} 字）：`);
  console.log(`    ${from.body.length > 200 ? `${from.body.slice(0, 200)}…` : from.body.replace(/\n/g, "\n    ")}`);

  if (!APPLY) {
    console.log("\n  加 APPLY=1 才真的写，并删掉这个文件。");
    process.exit(0);
  }
}

const out = append({ id, published, content: from.body }, year);

if (source) {
  rmSync(from.file);
  try {
    execFileSync("git", ["rm", "--cached", "--quiet", from.file], { stdio: "ignore" });
  } catch {
    // Untracked, which is the ordinary case for a draft. The file is gone anyway.
  }
  console.log(`\n  写入 ${out}`);
  console.log(`  删除 ${from.file}`);
} else {
  console.log(`  ${out}  ${id}`);
  console.log(`  ${from.body.length > 60 ? `${from.body.slice(0, 60)}…` : from.body}`);
}

console.log("\n  提交并部署之后它会被投递给关注者。");
