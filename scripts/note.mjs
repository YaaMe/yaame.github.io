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
 * The note goes straight into git and is visible after a commit and a deploy.
 * Nothing at runtime writes notes: D1 holds comments and reactions only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { append, newId } from "./notes-store.mjs";
import { postArchivePath } from "./comments-store.mjs";
import { apConfig, notes, posts } from "../src/config/data.config.generated.mjs";
import { noteSource, parseNoteDraft, checkNoteConversion, prepareNote } from "../src/services/authoring/notes.ts";

const APPLY = process.env.APPLY === "1";
const FORCE = process.env.FORCE === "1";
const postsRoot = posts.gitRoot;
const notesRoot = notes.gitRoot;

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

async function fromFile(path) {
  // A path if one exists, a slug otherwise. The draft this is for usually lives
  // wherever it was convenient to write it, not in the content directory.
  const asPost = join(postsRoot, `${path}.md`);
  const { file, slug } = noteSource(path, asPost, existsSync(path));
  if (!existsSync(file)) fail(`  没有这个文件：${path}`, `  也不是 ${asPost}`);
  const draft = parseNoteDraft(readFileSync(file, "utf8"), () => new Date());
  if (draft.status === "open-frontmatter") fail(`  ${file} 的 frontmatter 没有收尾`);
  if (draft.status === "empty") fail(`  ${file} 没有正文`);
  if (draft.status === "invalid-date") fail(`  date 读不成时间：${draft.written}`);

  if (slug) {
    const comments = postArchivePath(slug);
    const result = await checkNoteConversion(slug, FORCE, {
      hasComments: () => existsSync(comments),
      configuration: () => readFileSync(apConfig.file, "utf8"),
      request: fetch,
    });
    if (result.status === "comments") {
      fail(
        `\n  ✗ ${comments} 存在：有评论挂在这篇的 AP id 上`,
        "    转换会让它们指向一个不再应答的对象。先决定那些评论怎么办。",
      );
    }

    if (result.status === "configuration") fail(`  读不出 actorHost / user —— ${apConfig.file} 的形状变了，先看一眼再跑`);
    const address = result.address;
    if (result.status === "unreachable") {
      fail(
        `\n  ✗ 查不到 ${address} 是否已发布（网络问题？）`,
        "    这一步查不出来就该失败，而不是当作没发布过。",
      );
    }
    if (result.status === "published") {
      fail(
        `\n  ✗ 这篇已经联邦化了：${address}`,
        "    它的 id 在关注者的数据库里。转成短文会换成新 id，旧地址变 404，",
        "    而按协议该发的 Delete 这里发不出来（没有签名密钥，这是有意的）。",
        "\n    真要转：FORCE=1，代价如上。",
      );
    }
    if (result.live) console.error("\n  ⚠ FORCE=1：旧 id 会变成 404，远端引用悬空。");
  }

  return { file, ...draft };
}

const from = source ? await fromFile(source) : { body: text, when: new Date(), dated: true };

const { year, note } = prepareNote(from.body, from.when, newId);
const { id, published } = note;

if (source) {
  console.log(`  ${from.file}`);
  console.log(`    → ${join(notesRoot, `${year}.json`)}   id ${id}   ${published}`);
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

const out = append(note, year);

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
