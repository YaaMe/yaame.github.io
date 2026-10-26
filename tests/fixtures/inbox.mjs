import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The bundle configures logging globally, so it can be loaded once per test process.
// Durable records go to a temporary directory; `databaseUrl` replaces the in-memory
// database, and `openStore: false` leaves a store that is expected to fail unopened.
export async function inboxHarness(context, { databaseUrl = ":memory:", openStore = true, site = false, content = false, consumer = false, reload = false } = {}) {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-inbox-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const bundle = join(directory, "inbox.mjs");
  const built = await build({
    stdin: {
      contents: `
        ${site ? 'export { GET, POST } from "./src/routes/activitypub/federated.ts";' : ""}
        ${consumer ? 'export { default as consumer } from "./worker/consumer.ts";' : ""}
        ${site ? 'export { installSite } from "./src/routes/activitypub/site.ts";' : ""}
        ${reload && site ? 'export { installSite as reinstallSite } from "./src/routes/activitypub/site.ts?reload";' : ""}
        ${reload ? 'export { installShared as reinstallShared } from "./src/routes/activitypub/shared.ts?reload";' : ""}
        ${content ? 'export { collections, reads } from "./tests/fixtures/activitypub-content.mjs";' : ""}
        import { installShared } from "./src/routes/activitypub/shared.ts";
        installShared();
        export { installShared };
        export { reconcileFollowing } from "./src/services/activitypub/following.ts";
        export { followIntent } from "./src/config/data.config.generated.mjs";
        export { AP } from "./src/config/activitypub.ts";
        export { dropFollowersAt } from "./src/services/activitypub/followers.ts";
        export { federation } from "./src/services/activitypub/runtime.ts";
        export { platform } from "./src/platform/index.ts";
        export { record } from "./src/services/interactions/comments.ts";
        export { replies, replyCounts, withdrawnMany } from "./src/selectors/interactions/comments.ts";
        export { store } from "./src/persistence/interactions/database.ts";
        export { comments, followers, reactions, visitorIdentities, deliveries, failures } from "./src/models/interactions/tables.ts";
        export { counts as reactionCounts } from "./src/selectors/interactions/reactions.ts";
        export { insertComment } from "./src/persistence/interactions/write-comment.ts";
      `,
      resolveDir: process.cwd(),
    },
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    metafile: true,
    alias: {
      "virtual:astro": resolve(content ? "tests/fixtures/activitypub-content.mjs" : "worker/astro.stub.ts"),
      "virtual:platform": resolve("src/platform/node"),
    },
    define: {
      "process.env.AP_DB_URL": JSON.stringify(databaseUrl),
      "process.env.AP_DATA_DIR": JSON.stringify(join(directory, "data")),
    },
  });
  const inbox = await import(pathToFileURL(bundle).href);
  const database = openStore ? await inbox.store() : null;
  if (database) context.after(() => database.$client.close());
  context.mock.method(globalThis, "fetch", async () => {
    throw new Error("inbox tests are offline");
  });
  return {
    ...inbox,
    inputs: Object.keys(built.metafile.inputs),
    database,
    async receive(activity, stored = []) {
      await database.delete(inbox.comments);
      for (const row of stored) await inbox.insertComment(database, row);
      const dispatched = inbox.federation.inboxListeners.dispatchWithClass(activity);
      assert.ok(dispatched);
      await dispatched.listener({}, activity);
      return database.select().from(inbox.comments);
    },
  };
}
