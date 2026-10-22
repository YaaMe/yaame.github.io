import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePrerenderExport } from "../node_modules/astro/dist/core/routing/prerender.js";
import { Note } from "@fedify/fedify/vocab";
import * as scheme from "../src/models/activitypub/object-id.ts";
import { AP } from "../src/config/activitypub.ts";
import activitypub from "../src/integrations/activitypub/index.ts";
import { note, create } from "../src/selectors/activitypub/objects.ts";
import { page } from "../src/lib/page.ts";
import { matchUrl } from "../src/lib/path-template.ts";
import { inboxHarness } from "./fixtures/inbox.mjs";

test("the object scheme agrees with Fedify's registered context and injected routes", async (t) => {
  assert.equal(typeof scheme.objectUrl, "function");
  const { federation } = await inboxHarness(t, { site: true });
  const ctx = federation.createContext(new Request(`https://${AP.actorHost}/`), undefined);
  const injected = [];
  activitypub().hooks["astro:config:setup"]({
    injectRoute: (route) => injected.push(route.pattern),
    logger: { info() {} },
  });
  for (const [slug, encoded, decoded] of [
    ["2026-10-18", "2026-10-18", "2026-10-18"],
    ["8nicubmr", "8nicubmr", "8nicubmr"],
    ["未发表.1", "%E6%9C%AA%E5%8F%91%E8%A1%A8.1", "未发表.1"],
    ["a!b", "a%21b", null],
    ["a'b", "a%27b", null],
    ["a(b", "a%28b", null],
    ["a)b", "a%29b", null],
    ["a*b", "a%2Ab", null],
  ]) {
    const id = scheme.objectUrl(AP.actorHost, AP.user, slug);
    assert.equal(ctx.getObjectUri(Note, { identifier: AP.user, slug }).href, id.href);
    assert.equal(id.href, `https://${AP.actorHost}/users/${AP.user}/notes/${encoded}`);
    assert.equal(scheme.contentIdentifierOf(id.href, AP.actorHost, AP.user), decoded);
    assert.deepEqual(matchUrl(`https://${AP.actorHost}${scheme.OBJECT_PATH_TEMPLATE}`, id.href, { slug }), { identifier: AP.user });
    assert.ok(injected.some((pattern) => pattern.replace("[user]", AP.user).replace("[slug]", encoded) === id.pathname));
    const object = note(ctx, { slug, published: "2026-10-01T00:00:00Z", content: "Hello", url: new URL("https://blog.example/supplied/#anchor") });
    assert.equal(object.id.href, id.href);
    assert.equal(object.url.href, "https://blog.example/supplied/#anchor");
    assert.equal(create(ctx, object).id.href, `${id.href}#create`);
  }
});

test("neutral page windowing uses the supplied size and offset", () => {
  const items = ["a", "b", "c", "d", "e"];
  assert.deepEqual(page(items, 1, 2), { items: ["b", "c"], next: 3 });
  assert.deepEqual(page(items, 3, 2), { items: ["d", "e"], next: null });
  assert.deepEqual(page(items, 8, 2), { items: [], next: null });
});

test("Astro recognizes the temporary route forward as an on-demand entrance", () => {
  const routes = [];
  activitypub().hooks["astro:config:setup"]({ injectRoute: (route) => routes.push(route), logger: { info() {} } });
  for (const { entrypoint } of routes) {
    assert.equal(parsePrerenderExport(readFileSync(entrypoint, "utf8")), false);
  }
});
