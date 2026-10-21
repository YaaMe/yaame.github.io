import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// The bundle configures logging globally, so it can be loaded once per test process.
// Durable records go to a temporary directory; `databaseUrl` replaces the in-memory
// database, and `openStore: false` leaves a store that is expected to fail unopened.
export async function inboxHarness(context, { databaseUrl = ":memory:", openStore = true } = {}) {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-inbox-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const bundle = join(directory, "inbox.mjs");
  await build({
    stdin: {
      contents: `
        export { dropFollowersAt, federation } from "./src/integrations/activitypub/federation.ts";
        export { platform } from "./src/platform/index.ts";
        export { record } from "./src/services/interactions/comments.ts";
        export { replies, replyCounts, withdrawnMany } from "./src/selectors/interactions/comments.ts";
        export { store } from "./src/persistence/interactions/database.ts";
        export { comments, followers, reactions, visitorIdentities } from "./src/models/interactions/tables.ts";
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
    alias: { "virtual:platform": resolve("src/platform/node") },
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
