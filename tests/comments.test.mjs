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

const comment = {
  activityId: "https://example.test/activity",
  objectId: "https://example.test/object",
  rootId: "https://example.test/root",
  actorId: "https://mastodon.social/users/friend",
  published: "2026-10-10T00:00:00Z",
  replyToId: null,
  content: [[{ type: "text", text: "A readable response" }]],
};

for (const field of ["activityId", "objectId", "rootId", "actorId", "replyToId"]) {
  test(`${field} accepts HTTP and HTTPS URLs`, () => {
    for (const protocol of ["http", "https"]) {
      const value = `${protocol}://example.test/reference`;
      const parsed = commentSchema.parse({ ...comment, [field]: value });
      assert.equal(parsed[field], value);
    }
  });

  test(`${field} rejects non-HTTP(S) and incomplete URLs`, () => {
    for (const value of ["ftp://example.test/reference", "/reference", ""]) {
      const parsed = commentSchema.safeParse({ ...comment, [field]: value });
      assert.equal(parsed.success, false, `${field}: ${value}`);
      assert.deepEqual(parsed.error.issues.map((issue) => issue.path), [[field]]);
    }
  });
}

test("the schema keeps the permitted author and nullable reply target", () => {
  assert.equal(commentSchema.parse(comment).actorId, "https://mastodon.social/users/friend");
  assert.equal(commentSchema.parse(comment).replyToId, null);
  const { replyToId, ...withoutReply } = comment;
  assert.equal(commentSchema.parse(withoutReply).replyToId, null);
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
  const entry = { ...comment, name: 'Friend <reference> & "quoted"', content };
  const labels = [entry.name, "2026-10-10", content[0][1].label, content[0][2].handle, "#reference"];
  const hrefs = [entry.actorId, entry.objectId, ...content[0].slice(1).map((run) => run.href)];

  await context.test("HTTP and HTTPS links retain their labels and destinations", async () => {
    for (const protocol of ["http", "https"]) {
      const permitted = {
        ...entry,
        actorId: `${protocol}://mastodon.social/users/friend`,
        objectId: `${protocol}://example.test/object`,
      };
      const nodes = await render({ comments: [permitted] });
      const anchors = nodes.filter((node) => node.tagName === "a");
      assert.deepEqual(anchors.map((node) => text(node).trim()), labels);
      assert.deepEqual(anchors.map((node) => attribute(node, "href")), [permitted.actorId, permitted.objectId, ...hrefs.slice(2)]);
      assert.ok(anchors.every((node) => attribute(node, "rel") === "nofollow ugc"));
      assert.ok(nodes.some((node) => node.nodeName === "#text" && node.value.includes("Readable <reference> & text")));
      assert.equal(nodes.some((node) => node.tagName === "reference" || node.tagName === "one"), false);
    }
  });

  for (const [index, field] of ["actor", "object", "link", "mention", "hashtag"].entries()) {
    await context.test(`${field} retains readable text when its href is rejected`, async () => {
      for (const value of ["ftp://example.test/reference", "/reference", ""]) {
        const rejected = structuredClone(entry);
        if (index < 2) rejected[index === 0 ? "actorId" : "objectId"] = value;
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
    const nodes = await render({ comments: [{ ...comment, actorId: "ftp://example.test/users/friend" }] });
    const author = nodes.find((node) => node.tagName === "a" && text(node).trim() === "@friend@example.test");
    assert.ok(author);
    assert.equal(attribute(author, "href"), undefined);
  });

  await context.test("a withdrawn comment keeps its date and notice without rejected hrefs", async () => {
    const nodes = await render({ comments: [{ ...entry, actorId: "ftp://example.test/reference", objectId: "ftp://example.test/reference", content: undefined, deletedAt: "2026-10-11T00:00:00Z" }] });
    assert.ok(nodes.filter((node) => node.tagName === "a").every((node) => attribute(node, "href") === undefined));
    assert.ok(nodes.some((node) => node.tagName === "p" && text(node).includes("已由作者删除 · 2026-10-11")));
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
  const promoted = promotedComment({
    activity_id: "https://example.test/activity",
    object_id: "https://example.test/object",
    root_id: "https://example.test/root",
    reply_to_id: null,
    actor_id: "https://example.test/actor",
    content: [
      '<p>第一段 &amp; &lt;安全&gt; &#x27;<br>继续 <a class="mention u-url" href="https://social.example/@alice">@alice@social.example</a> <a class="mention hashtag" href="https://social.example/tags/astro">#astro</a></p>',
      '<p>第二段：<a href="https://example.test/?a=1&amp;b=2"><span class="invisible">https://</span><span class="visible">example.test/</span><span class="invisible">private</span><span class="ellipsis">…</span></a>。</p>',
    ].join(""),
    published: "2026-10-10T00:00:00Z",
  });

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
  const promoted = promotedComment({
    activity_id: "https://example.test/activity-2",
    object_id: "https://example.test/object-2",
    root_id: "https://example.test/root",
    reply_to_id: null,
    actor_id: "https://example.test/actor",
    content: '<p>参考：<a href="ftp://example.test/reference">显示 &amp; 文本</a></p>',
    published: "2026-10-10T00:00:00Z",
  });

  assert.deepEqual(promoted.content, [[
    { type: "text", text: "参考：显示 & 文本" },
  ]]);
});

test("a withdrawn reply and its withdrawn parent disappear at the fixed point", () => {
  const comments = [
    { objectId: "https://example.test/parent", replyToId: null, content: "parent" },
    {
      objectId: "https://example.test/reply",
      replyToId: "https://example.test/parent",
      content: "reply",
    },
  ];

  assert.deepEqual(
    visibleComments(
      comments,
      new Map([
        ["https://example.test/parent", "2026-10-10T00:00:00Z"],
        ["https://example.test/reply", "2026-10-10T00:01:00Z"],
      ]),
    ),
    [],
  );
});

test("a withdrawn parent remains as a tombstone while a live reply answers it", () => {
  const parent = {
    objectId: "https://example.test/parent",
    replyToId: null,
    content: "parent",
  };
  const reply = {
    objectId: "https://example.test/reply",
    replyToId: parent.objectId,
    content: "reply",
  };

  const result = visibleComments(
    [parent, reply],
    new Map([[parent.objectId, "2026-10-10T00:00:00Z"]]),
  );
  assert.equal(result[0].content, undefined);
  assert.equal(result[0].deletedAt, "2026-10-10T00:00:00Z");
  assert.equal(result[1].content, "reply");
});

test("promotion files note threads by archive year and post threads by slug", () => {
  assert.equal(fileFor("https://yaame.dev/users/yaame/notes/8nicubmr"), "src/content/comments/notes/2026.json");
  assert.equal(fileFor("https://yaame.dev/users/yaame/notes/2023-07"), "src/content/comments/posts/2023-07.json");
  assert.equal(fileFor("https://other.example/not-a-root"), null);
});
