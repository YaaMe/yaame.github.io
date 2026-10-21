import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import * as schemas from "../src/selectors/content/collections.ts";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/content.config.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "collection-registration",
    setup(builder) {
      builder.onResolve({ filter: /^astro(?::content|\/loaders)$/ }, ({ path }) => ({ path, namespace: "astro" }));
      builder.onLoad({ filter: /.*/, namespace: "astro" }, () => ({
        contents: "export const defineCollection = (value) => value; export const glob = (value) => value;",
      }));
      builder.onResolve({ filter: /\/selectors\/content\/collections$/ }, () => ({
        path: new URL("../src/selectors/content/collections.ts", import.meta.url).href,
        external: true,
      }));
    },
  }],
});
const { collections } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("posts and komorebi preserve fields, tag validation and stamped dates", () => {
  const date = "2025-12-31T16:30:00Z";
  const stamp = { at: new Date(date), y: "2026", mo: "01", d: "01", iso: "2025-12-31T16:30:00.000Z" };
  for (const name of ["posts", "komorebi"]) {
    const schema = collections[name].schema;
    assert.deepEqual(schema.parse({ title: "Title", date, ignored: true }), {
      title: "Title", pinned: false, tags: [], date: stamp,
    });
    for (const [tags, expected] of [
      [undefined, []], [null, []], [[], []], ["gugu", ["gugu"]],
      [["month", "gugu", "month"], ["month", "gugu", "month"]],
    ]) {
      assert.deepEqual(schema.parse({ title: "Title", date, tags }).tags, expected);
    }
    assert.deepEqual(schema.parse({ title: "Title", date, pinned: true, description: "Authored" }), {
      title: "Title", pinned: true, description: "Authored", tags: [], date: stamp,
    });
    for (const invalid of [
      { date }, { title: 42, date }, { title: "Title", date: "invalid" },
      { title: "Title", date, pinned: "true" }, { title: "Title", date, description: null },
      { title: "Title", date, tags: "unregistered" }, { title: "Title", date, tags: ["gugu", "unregistered"] },
      { title: "Title", date, tags: 42 }, { title: "Title", date, tags: [null] },
    ]) {
      assert.equal(schema.safeParse(invalid).success, false, `${name}: ${JSON.stringify(invalid)}`);
    }
    assert.equal(schema.parse({ title: "", date: 0 }).date.iso, "1970-01-01T00:00:00.000Z");
    assert.equal(schema.parse({ title: "Title", date: null }).date.iso, "1970-01-01T00:00:00.000Z");
  }
  assert.equal(collections.posts.schema.safeParse({ title: "Title" }).success, false);
  assert.deepEqual(collections.komorebi.schema.parse({ title: "Title" }), { title: "Title", pinned: false, tags: [] });
});

test("notes preserve archive shape and the existing identifier rule", () => {
  const schema = collections.notes.schema;
  const note = { id: "8nicubmr", published: "2025-12-31T16:30:00Z", content: "**Note**" };
  assert.deepEqual(schema.parse({ notes: [{ ...note, title: "Ignored" }], ignored: true }), { notes: [note] });
  assert.deepEqual(schema.parse({ notes: [] }), { notes: [] });
  assert.deepEqual(schema.parse({ notes: [note, note] }), { notes: [note, note] });
  for (const id of ["abc123", "abcdefgh1234", "20231018"]) {
    assert.equal(schema.parse({ notes: [{ ...note, id, published: "unparsed", content: "" }] }).notes[0].id, id);
  }
  for (const id of ["2023-07", "2025-year", "2026-10-21", "short", "abcdefgh12345", "ABC123", "abc_12"]) {
    const parsed = schema.safeParse({ notes: [{ ...note, id }] });
    assert.equal(parsed.success, false, id);
    assert.equal(parsed.error.issues[0].message, "短随机串，不要日期形状");
  }
  for (const invalid of [{}, { notes: note }, { notes: [{ id: note.id, content: "Note" }] }, { notes: [{ ...note, content: 42 }] }]) {
    assert.equal(schema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test("registration uses every model schema exposed by the plain-Node selector", () => {
  assert.equal(collections.posts.schema, schemas.postCollectionSchema);
  assert.equal(collections.notes.schema, schemas.noteCollectionSchema);
  assert.equal(collections.komorebi.schema, schemas.komorebiCollectionSchema);
  assert.equal(collections.comments.schema, schemas.commentCollectionSchema);
});
