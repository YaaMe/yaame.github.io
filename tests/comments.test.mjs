import test from "node:test";
import assert from "node:assert/strict";
import { promotedComment } from "../scripts/promote.mjs";
import { fileFor } from "../scripts/comments-store.mjs";
import { renderedText } from "../src/lib/comment-runs.ts";
import { visibleComments } from "../src/lib/comment-view.ts";

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
    content: '<p>坏链接：<a href="javascript:alert(1)">显示 &amp; 文本</a></p>',
    published: "2026-10-10T00:00:00Z",
  });

  assert.deepEqual(promoted.content, [[
    { type: "text", text: "坏链接：显示 & 文本" },
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
