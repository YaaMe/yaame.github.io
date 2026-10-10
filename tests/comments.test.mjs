import test from "node:test";
import assert from "node:assert/strict";
import { fileFor, promotedComment } from "../scripts/promote.mjs";
import { paragraphs, segments } from "../src/lib/comment-text.ts";
import { visibleComments } from "../src/lib/comment-view.ts";

test("promotion text reaches the paragraph and link view as plain text", () => {
  const promoted = promotedComment({
    activity_id: "https://example.test/activity",
    object_id: "https://example.test/object",
    root_id: "https://example.test/root",
    reply_to_id: null,
    actor_id: "https://example.test/actor",
    content: '<p>第一段 &amp; &lt;安全&gt; &#x27;</p><p>第二段：<a href="https://example.test/?a=1&amp;b=2">链接</a>。</p>',
    published: "2026-10-10T00:00:00Z",
  });
  const text = promoted.content;

  assert.deepEqual(paragraphs(text), [
    "第一段 & <安全> '",
    "第二段：链接（https://example.test/?a=1&b=2）。",
  ]);
  assert.deepEqual(segments(paragraphs(text)[1]), [
    { text: "第二段：链接（" },
    { url: "https://example.test/?a=1&b=2" },
    { text: "）。" },
  ]);
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
