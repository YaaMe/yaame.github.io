import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { database as nodeDatabase } from "../../src/platform/node/database.ts";
import { database as d1Database } from "../../src/platform/cloudflare/database.ts";
import { schemaBootstrapStatements } from "../../src/integrations/activitypub/store/schema.ts";

// The bootstrap records one version row per migration, so this follows every append.
export const LATEST_MIGRATION = schemaBootstrapStatements().filter((statement) => statement.startsWith("INSERT OR IGNORE INTO")).length - 1;

export async function testDatabase(context, host) {
  if (host === "node") {
    const directory = mkdtempSync(join(tmpdir(), "blogu-interactions-"));
    const file = join(directory, "test.sqlite");
    const client = new DatabaseSync(file);
    const concurrentClient = new DatabaseSync(file);
    context.after(() => { client.close(); concurrentClient.close(); rmSync(directory, { recursive: true, force: true }); });
    return {
      database: nodeDatabase(client), concurrent: nodeDatabase(concurrentClient), client, file,
      execute: async (statement) => client.exec(statement),
      rows: async (statement) => client.prepare(statement).all(),
    };
  }
  const runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] }));
  context.after(() => runtime.dispose());
  const client = await runtime.getD1Database("DB");
  return {
    database: d1Database(client), concurrent: d1Database(await runtime.getD1Database("DB")), client,
    execute: async (statement) => client.prepare(statement).run(),
    rows: async (statement) => (await client.prepare(statement).all()).results,
  };
}
