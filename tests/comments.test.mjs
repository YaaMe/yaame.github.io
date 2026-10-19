import test from "node:test";
import assert from "node:assert/strict";
import { glob, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transform } from "@astrojs/compiler-rs";
import { build } from "esbuild";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseFragment } from "parse5";
import { promotedComment } from "../scripts/promote.mjs";
import { fileFor } from "../scripts/comments-store.mjs";
import { promotedComments } from "../src/data.config.generated.mjs";
import { commentSchema } from "../src/lib/interactions/comment-schema.ts";
import { renderedText } from "../src/lib/interactions/comment-runs.ts";
import { visibleComments } from "../src/lib/interactions/comment-view.ts";
import { SOURCES, commentId, identityId } from "../src/lib/interactions/key-scheme.ts";

const author = {
  id: identityId(SOURCES.activitypub, "https://example.test/users/friend"),
  source: SOURCES.activitypub,
  identifier: "https://example.test/users/friend",
};
const comment = {
  id: commentId({ source: SOURCES.activitypub, identifier: author.identifier, objectId: "https://example.test/object" }),
  source: SOURCES.activitypub,
  activityId: "https://example.test/activity",
  objectId: "https://example.test/object",
  root: "written-slug",
  author,
  published: "2026-10-10T00:00:00Z",
  replyTo: null,
  inReplyTo: "https://yaame.dev/users/yaame/notes/written-slug",
  content: [[{ type: "text", text: "A readable response" }]],
};
const commentRow = {
  id: comment.id,
  source: comment.source,
  identifier: author.identifier,
  author_id: author.id,
  activity_id: comment.activityId,
  object_id: comment.objectId,
  in_reply_to: comment.inReplyTo,
  root: comment.root,
  reply_to: comment.replyTo,
  submission_id: null,
  published: comment.published,
  received_at: comment.published,
  deleted_at: null,
  promoted_at: null,
};

test("the schema accepts HTTP(S) metadata with matching ActivityPub identity hashes", () => {
  for (const protocol of ["http", "https"]) {
    const identifier = `${protocol}://example.test/users/friend`;
    const activityId = `${protocol}://example.test/activity`;
    const objectId = `${protocol}://example.test/object`;
    const entry = {
      ...comment,
      id: commentId({ source: SOURCES.activitypub, identifier, objectId }),
      activityId,
      objectId,
      inReplyTo: `${protocol}://yaame.dev/users/yaame/notes/written-slug`,
      author: { ...author, id: identityId(SOURCES.activitypub, identifier), identifier, name: "Friend" },
    };
    assert.deepEqual(commentSchema.parse(entry), entry);
  }
});

for (const field of ["activityId", "objectId", "inReplyTo"]) {
  test(`${field} rejects non-HTTP(S) and incomplete URLs`, () => {
    for (const value of ["ftp://example.test/reference", "javascript:alert(1)", "data:text/html,reference", "/reference", ""]) {
      const parsed = commentSchema.safeParse({ ...comment, [field]: value });
      assert.equal(parsed.success, false, `${field}: ${value}`);
      assert.ok(parsed.error.issues.some((issue) => issue.path.join(".") === field));
    }
  });
}

test("the schema keeps the permitted author and nullable reply target", () => {
  assert.deepEqual(commentSchema.parse(comment).author, author);
  assert.equal(commentSchema.parse(comment).replyTo, null);
  const { replyTo, ...withoutReply } = comment;
  assert.equal(commentSchema.parse(withoutReply).replyTo, null);
  assert.equal(commentSchema.parse({ ...comment, replyTo: comment.id }).replyTo, comment.id);
  for (const replyTo of [comment.objectId, "not-a-uuid", "93dd7f06-26c1-4c35-9a73-79df6ec41607"]) {
    assert.equal(commentSchema.safeParse({ ...comment, replyTo }).success, false, replyTo);
  }
});

test("the schema rejects invalid actor URLs and mismatched identity hash inputs", () => {
  for (const identifier of ["ftp://example.test/users/friend", "javascript:alert(1)", "/friend", ""]) {
    const parsed = commentSchema.safeParse({ ...comment, author: { ...author, identifier } });
    assert.equal(parsed.success, false, identifier);
    assert.ok(parsed.error.issues.some((issue) => issue.path.join(".") === "author.identifier"));
  }
  const otherIdentifier = "https://example.test/users/other";
  const otherIdentityId = identityId(SOURCES.activitypub, otherIdentifier);
  for (const entry of [
    { ...comment, id: otherIdentityId },
    { ...comment, id: "not-a-uuid" },
    { ...comment, id: "93dd7f06-26c1-4c35-9a73-79df6ec41607" },
    { ...comment, objectId: "https://example.test/other-object" },
    { ...comment, activityId: "https://other.example/activity" },
    { ...comment, author: { ...author, id: otherIdentityId } },
    { ...comment, author: { ...author, id: otherIdentityId, identifier: otherIdentifier } },
    { ...comment, objectId: "https://other.example/object" },
    { ...comment, source: SOURCES.github },
    { ...comment, author: { ...author, source: SOURCES.github } },
  ]) {
    assert.equal(commentSchema.safeParse(entry).success, false, JSON.stringify(entry));
  }
});

test("the archive validates Note identity while preserving the Create attribute", () => {
  const rewrapped = { ...comment, activityId: "https://example.test/other-activity" };
  assert.deepEqual(commentSchema.parse(rewrapped), rewrapped);
});

test("the schema accepts content identifiers and rejects ActivityPub URLs as roots", () => {
  for (const root of ["written-slug", "2023-07", "8nicubmr"]) {
    assert.equal(commentSchema.parse({ ...comment, root }).root, root);
  }
  for (const root of [comment.inReplyTo, "", "../written-slug"]) {
    assert.equal(commentSchema.safeParse({ ...comment, root }).success, false, root);
  }
});

test("a promoted tombstone retains neither structured nor raw content", () => {
  const tombstone = { ...comment, content: undefined, deletedAt: "2026-10-11T00:00:00Z" };
  assert.equal(commentSchema.safeParse(tombstone).success, true);
  assert.equal(commentSchema.safeParse({ ...tombstone, content: comment.content }).success, false);
  assert.equal(commentSchema.safeParse({ ...tombstone, rawContent: "<p>withdrawn text</p>" }).success, false);
});

for (const run of [
  { type: "link", label: "Reference" },
  { type: "mention", handle: "@friend@example.test" },
  { type: "hashtag", name: "reference" },
]) {
  test(`${run.type} runs accept HTTP(S) hrefs and reject other URLs`, () => {
    for (const protocol of ["http", "https"]) {
      const content = [[{ ...run, href: `${protocol}://example.test/reference` }]];
      assert.deepEqual(commentSchema.parse({ ...comment, content }).content, content);
    }
    for (const href of ["ftp://example.test/reference", "/reference", ""]) {
      const parsed = commentSchema.safeParse({ ...comment, content: [[{ ...run, href }]] });
      assert.equal(parsed.success, false, href);
      assert.deepEqual(parsed.error.issues.map((issue) => issue.path), [["content", 0, 0, "href"]]);
    }
  });
}

test("stored comment documents satisfy the comment schema", async (context) => {
  let records = 0;
  for await (const filename of glob(promotedComments.git, { cwd: new URL("../", import.meta.url) })) {
    const document = JSON.parse(await readFile(new URL(`../${filename}`, import.meta.url), "utf8"));
    for (const entry of document.comments) {
      assert.equal(commentSchema.safeParse(entry).success, true, filename);
      records += 1;
    }
  }
  context.diagnostic(`Checked ${records} stored comment records.`);
});

test("comment readers use content identifiers and internal withdrawal IDs", async () => {
  const newerActivity = "https://example.test/newer-activity";
  const newer = {
    ...comment,
    id: commentId({ source: SOURCES.activitypub, identifier: author.identifier, objectId: "https://example.test/newer-object" }),
    activityId: newerActivity,
    objectId: "https://example.test/newer-object",
    published: "2026-10-11T00:00:00Z",
  };
  const note = { ...comment, root: "8nicubmr" };
  const filenamePost = { ...comment, root: "2023-07" };
  const files = [
    { data: { comments: [newer, note] } },
    { data: { comments: [comment, filenamePost] } },
  ];
  const deletedAt = "2026-10-12T00:00:00Z";
  const bundle = await build({
    stdin: {
      contents: `
        export { commentsFor, handle } from "./comments";
        export { liveCommentsFor, liveCommentsForMany } from "./comments-live";
        export { withdrawalCalls, withdrawalState } from "../../integrations/activitypub/store/comments";
      `,
      resolveDir: fileURLToPath(new URL("../src/lib/interactions/", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "comment-reader-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /^astro:content$/ }, () => ({ path: "content", namespace: "collection" }));
        builder.onLoad({ filter: /.*/, namespace: "collection" }, () => ({
          contents: `
            export async function getCollection(name) {
              if (name !== "comments") throw new Error("Unexpected collection");
              return ${JSON.stringify(files)};
            }
          `,
        }));
        builder.onResolve({ filter: /\/store\/comments$/ }, () => ({ path: "withdrawals", namespace: "store" }));
        builder.onLoad({ filter: /.*/, namespace: "store" }, () => ({
          contents: `
            export const withdrawalCalls = [];
            export const withdrawalState = { fail: false };
            const byRoot = new Map([[${JSON.stringify(comment.root)}, new Map([[${JSON.stringify(comment.id)}, ${JSON.stringify(deletedAt)}]])]]);
            export async function withdrawn(contentId) {
              withdrawalCalls.push(contentId);
              if (withdrawalState.fail) throw new Error("Withdrawals unavailable");
              return byRoot.get(contentId) ?? new Map();
            }
            export async function withdrawnMany(contentIds) {
              withdrawalCalls.push(contentIds);
              if (withdrawalState.fail) throw new Error("Withdrawals unavailable");
              return new Map(contentIds.filter((contentId) => byRoot.has(contentId)).map((contentId) => [contentId, byRoot.get(contentId)]));
            }
          `,
        }));
      },
    }],
  });
  const { commentsFor, handle, liveCommentsFor, liveCommentsForMany, withdrawalCalls, withdrawalState } =
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

  assert.deepEqual(await commentsFor(comment.root), [comment, newer]);
  assert.deepEqual(await commentsFor(note.root), [note]);
  assert.deepEqual(await commentsFor(filenamePost.root), [filenamePost]);
  assert.deepEqual(await commentsFor(comment.inReplyTo), []);
  assert.deepEqual(await commentsFor("missing-root"), []);
  assert.deepEqual(await commentsFor(comment.root, new Map([[comment.id, deletedAt]])), [newer]);
  assert.deepEqual(withdrawalCalls, []);

  assert.deepEqual(await liveCommentsFor(comment.root), [newer]);
  assert.deepEqual(withdrawalCalls, [comment.root]);
  const roots = [comment.root, note.root, filenamePost.root, "missing-root"];
  assert.deepEqual(await liveCommentsForMany(roots), new Map([
    [comment.root, [newer]],
    [note.root, [note]],
    [filenamePost.root, [filenamePost]],
    ["missing-root", []],
  ]));
  assert.deepEqual(withdrawalCalls, [comment.root, roots]);
  assert.deepEqual(await liveCommentsForMany([]), new Map());

  assert.equal(handle(author), "@friend@example.test");
  assert.equal(handle({ ...author, name: "A renamed friend" }), "@friend@example.test");
  assert.equal(handle({ ...author, identifier: "https://example.test/" }), "example.test");
  assert.equal(handle({ ...author, identifier: "invalid actor" }), "invalid actor");
  assert.equal(handle({ source: SOURCES.github, identifier: "123" }), "");
  assert.equal(handle({ source: SOURCES.github, identifier: author.identifier }), "");

  withdrawalState.fail = true;
  await assert.rejects(liveCommentsFor(comment.root), /Withdrawals unavailable/);
  await assert.rejects(liveCommentsForMany(roots), /Withdrawals unavailable/);
});

test("Comments checks hrefs at the rendered boundary", async (context) => {
  const filename = fileURLToPath(new URL("../src/components/Comments.astro", import.meta.url));
  const compiled = transform(await readFile(filename, "utf8"), {
    filename,
    internalURL: "astro/compiler-runtime",
    resultScopedSlot: true,
    inlineComponentAssets: true,
    resolvePath: (specifier) => specifier,
  });
  const bundle = await build({
    stdin: { contents: compiled.code, resolveDir: fileURLToPath(new URL("../src/components/", import.meta.url)), loader: "ts" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "comment-render",
      setup(builder) {
        builder.onResolve({ filter: /^astro:content$/ }, () => ({ path: "content", namespace: "collection" }));
        builder.onLoad({ filter: /.*/, namespace: "collection" }, () => ({
          contents: 'export function getCollection() { throw new Error("Unexpected collection read"); }',
        }));
        builder.onResolve({ filter: /^(astro\/|zod$)/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
      },
    }],
  });
  const { default: Comments } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const container = await AstroContainer.create();
  const descendants = (node) => [node, ...(node.childNodes ?? []).flatMap(descendants)];
  const text = (node) => descendants(node).filter((child) => child.nodeName === "#text").map((child) => child.value).join("");
  const attribute = (node, name) => node.attrs?.find((attr) => attr.name === name)?.value;
  const render = async (props) => descendants(parseFragment(await container.renderToString(Comments, { props })));
  const content = [[
    { type: "text", text: "Readable <reference> & text" },
    { type: "link", href: "https://example.test/reference?a=1&b=2", label: 'Reference <one> & "quoted"' },
    { type: "mention", href: "http://example.test/users/friend", handle: "@friend@example.test" },
    { type: "hashtag", href: "https://example.test/tags/reference", name: "reference" },
  ]];
  const entry = { ...comment, author: { ...author, name: 'Friend <reference> & "quoted"' }, content };
  const labels = [entry.author.name, "2026-10-10", content[0][1].label, content[0][2].handle, "#reference"];
  const hrefs = [entry.author.identifier, entry.objectId, ...content[0].slice(1).map((run) => run.href)];

  await context.test("HTTP and HTTPS links retain their labels and destinations", async () => {
    for (const protocol of ["http", "https"]) {
      const permitted = {
        ...entry,
        author: { ...entry.author, identifier: `${protocol}://example.test/users/friend` },
        objectId: `${protocol}://example.test/object`,
      };
      const nodes = await render({ comments: [permitted] });
      const anchors = nodes.filter((node) => node.tagName === "a");
      assert.deepEqual(anchors.map((node) => text(node).trim()), labels);
      assert.deepEqual(anchors.map((node) => attribute(node, "href")), [permitted.author.identifier, permitted.objectId, ...hrefs.slice(2)]);
      assert.ok(anchors.every((node) => attribute(node, "rel") === "nofollow ugc"));
      assert.ok(nodes.some((node) => node.nodeName === "#text" && node.value.includes("Readable <reference> & text")));
      assert.equal(nodes.some((node) => node.tagName === "reference" || node.tagName === "one"), false);
    }
  });

  for (const [index, field] of ["actor", "object", "link", "mention", "hashtag"].entries()) {
    await context.test(`${field} retains readable text when its href is rejected`, async () => {
      for (const value of ["ftp://example.test/reference", "javascript:alert(1)", "data:text/html,reference", "//example.test/reference", "/reference", ""]) {
        const rejected = structuredClone(entry);
        if (index === 0) rejected.author.identifier = value;
        else if (index === 1) rejected.objectId = value;
        else rejected.content[0][index - 1].href = value;
        const nodes = await render({ comments: [rejected] });
        const anchors = nodes.filter((node) => node.tagName === "a");
        const expected = [...hrefs];
        expected[index] = undefined;
        assert.deepEqual(anchors.map((node) => attribute(node, "href")), expected);
        assert.deepEqual(anchors.map((node) => text(node).trim()), labels);
      }
    });
  }

  await context.test("an unnamed author keeps its handle when its href is rejected", async () => {
    const nodes = await render({ comments: [{ ...comment, author: { ...author, identifier: "ftp://example.test/users/friend" } }] });
    const authorLink = nodes.find((node) => node.tagName === "a" && text(node).trim() === "@friend@example.test");
    assert.ok(authorLink);
    assert.equal(attribute(authorLink, "href"), undefined);
  });

  await context.test("a withdrawn comment keeps its date and notice without rejected hrefs", async () => {
    const nodes = await render({ comments: [{ ...entry, author: { ...entry.author, identifier: "ftp://example.test/reference" }, objectId: "ftp://example.test/reference", content: undefined, deletedAt: "2026-10-11T00:00:00Z" }] });
    assert.ok(nodes.filter((node) => node.tagName === "a").every((node) => attribute(node, "href") === undefined));
    assert.ok(nodes.some((node) => node.tagName === "p" && text(node).includes("已由作者删除 · 2026-10-11")));
  });

  await context.test("rendered threads publish public links without internal IDs or raw HTML", async () => {
    const rawContent = '<script>window.rawComment = true</script><img src=x onerror="alert(1)">';
    const replyActivity = "https://example.test/reply-activity";
    const reply = {
      ...comment,
      id: commentId({ source: SOURCES.activitypub, identifier: author.identifier, objectId: "https://example.test/reply-object" }),
      activityId: replyActivity,
      objectId: "https://example.test/reply-object",
      replyTo: comment.id,
      inReplyTo: comment.objectId,
      content: [[{ type: "text", text: '<img src=x onerror="alert(1)"> is plain text' }]],
      rawContent,
    };
    const html = await container.renderToString(Comments, {
      props: { comments: [{ ...entry, rawContent }, reply], state: "loaded", forId: comment.root },
    });
    for (const internalId of [entry.id, entry.author.id, reply.id, reply.replyTo]) {
      assert.equal(html.includes(internalId), false, internalId);
    }
    assert.equal(html.includes(rawContent), false);
    const nodes = descendants(parseFragment(html));
    assert.equal(nodes.some((node) => ["script", "img"].includes(node.tagName)), false);
    assert.ok(nodes.some((node) => node.tagName === "p" && text(node).trim() === reply.content[0][0].text));
    assert.ok(nodes.some((node) => node.tagName === "a" && attribute(node, "href") === entry.author.identifier));
    assert.ok(nodes.some((node) => node.tagName === "a" && attribute(node, "href") === reply.objectId));
    const section = nodes.find((node) => node.tagName === "section");
    assert.equal(attribute(section, "data-comments-for"), comment.root);
    assert.equal(attribute(section, "data-comments-state"), "loaded");
    assert.equal(attribute(section, "hidden"), undefined);
    assert.equal(attribute(section, "aria-busy"), undefined);
  });

  await context.test("empty and pending sections preserve their state markers", async () => {
    assert.equal((await render({ comments: [] })).some((node) => node.tagName === "section"), false);
    for (const state of ["pending", "loaded"]) {
      const nodes = await render({ comments: state === "pending" ? [entry] : [], state, forId: "reference" });
      const section = nodes.find((node) => node.tagName === "section");
      assert.ok(section);
      assert.equal(attribute(section, "data-comments-state"), state);
      assert.equal(attribute(section, "data-comments-for"), "reference");
      assert.equal(attribute(section, "hidden"), "");
      assert.equal(attribute(section, "aria-busy"), state === "pending" ? "true" : undefined);
      assert.equal(nodes.some((node) => node.tagName === "a"), false);
    }
  });
});

test("Mastodon markup becomes typed runs and the rendered text", () => {
  const rawContent = [
    '<p>第一段 &amp; &lt;安全&gt; &#x27;<br>继续 <a class="mention u-url" href="https://social.example/@alice">@alice@social.example</a> <a class="mention hashtag" href="https://social.example/tags/astro">#astro</a></p>',
    '<p>第二段：<a href="https://example.test/?a=1&amp;b=2"><span class="invisible">https://</span><span class="visible">example.test/</span><span class="invisible">private</span><span class="ellipsis">…</span></a>。</p>',
  ].join("");
  const promoted = commentSchema.parse(promotedComment({
    ...commentRow,
    content: rawContent,
  }));

  assert.equal(promoted.replyTo, null);
  assert.equal(Object.hasOwn(promoted, "rawContent"), false);
  assert.deepEqual(promoted.content, [
    [
      { type: "text", text: "第一段 & <安全> '\n继续 " },
      { type: "mention", href: "https://social.example/@alice", handle: "@alice@social.example" },
      { type: "text", text: " " },
      { type: "hashtag", href: "https://social.example/tags/astro", name: "astro" },
    ],
    [
      { type: "text", text: "第二段：" },
      { type: "link", href: "https://example.test/?a=1&b=2", label: "example.test/…" },
      { type: "text", text: "。" },
    ],
  ]);
  assert.equal(
    renderedText(promoted.content),
    "第一段 & <安全> '\n继续 @alice@social.example #astro\n\n第二段：example.test/…。",
  );
});

test("a non-http link degrades to a text run", () => {
  const promoted = commentSchema.parse(promotedComment({
    ...commentRow,
    content: '<p>参考：<a href="ftp://example.test/reference">显示 &amp; 文本</a></p>',
  }));

  assert.deepEqual(promoted.content, [[
    { type: "text", text: "参考：显示 & 文本" },
  ]]);
});

test("a withdrawn reply and its withdrawn parent disappear at the fixed point", () => {
  const parentId = commentId({ source: SOURCES.activitypub, identifier: author.identifier, objectId: "https://example.test/parent" });
  const replyId = commentId({ source: SOURCES.activitypub, identifier: author.identifier, objectId: "https://example.test/reply" });
  const comments = [
    { id: parentId, objectId: "https://example.test/parent", replyTo: null, content: "parent" },
    {
      id: replyId,
      objectId: "https://example.test/reply",
      replyTo: parentId,
      content: "reply",
    },
  ];

  assert.deepEqual(
    visibleComments(
      comments,
      new Map([
        [parentId, "2026-10-10T00:00:00Z"],
        [replyId, "2026-10-10T00:01:00Z"],
      ]),
    ),
    [],
  );
  assert.deepEqual(visibleComments(comments.map((entry) => ({ ...entry, deletedAt: "2026-10-10T00:00:00Z" }))), []);
});

test("a withdrawn parent remains as a tombstone while a live reply answers it", () => {
  const parent = {
    id: commentId({ source: SOURCES.activitypub, identifier: author.identifier, objectId: "https://example.test/parent" }),
    objectId: "https://example.test/parent",
    replyTo: null,
    content: "parent",
  };
  const reply = {
    id: commentId({ source: SOURCES.activitypub, identifier: author.identifier, objectId: "https://example.test/reply" }),
    objectId: "https://example.test/reply",
    replyTo: parent.id,
    content: "reply",
  };

  const result = visibleComments(
    [parent, reply],
    new Map([[parent.id, "2026-10-10T00:00:00Z"]]),
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].content, undefined);
  assert.equal(result[0].deletedAt, "2026-10-10T00:00:00Z");
  assert.equal(result[1].content, "reply");
  assert.equal(parent.content, "parent");
  assert.deepEqual(visibleComments([parent, reply], new Map([[parent.objectId, "2026-10-10T00:00:00Z"]])), [parent, reply]);
  assert.deepEqual(visibleComments([{ ...parent, deletedAt: "2026-10-10T00:00:00Z" }, reply]), result);
});

test("promotion files note threads by archive year and post threads by slug", () => {
  assert.equal(fileFor("8nicubmr"), "src/content/comments/notes/2026.json");
  assert.equal(fileFor("2023-07"), "src/content/comments/posts/2023-07.json");
  assert.equal(fileFor("written-slug"), "src/content/comments/posts/written-slug.json");
  assert.equal(fileFor("https://yaame.dev/users/yaame/notes/8nicubmr"), null);
  assert.equal(fileFor("https://other.example/not-a-root"), null);
});
