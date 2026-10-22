import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as schema from "../src/services/interactions/schema.ts";
import { database as nodeDatabase } from "../src/platform/node/database.ts";

test("the named ledger DDL preserves bootstrap order and exported migration timestamps", async (context) => {
  assert.equal(typeof schema.migrationLedgerStatement, "function");
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-22T00:00:00Z") });
  const ledger = schema.migrationLedgerStatement();
  assert.equal(ledger, 'CREATE TABLE IF NOT EXISTS "migrations" ("version" INTEGER PRIMARY KEY, "applied_at" TEXT NOT NULL)');
  const bootstrap = schema.schemaBootstrapStatements({ includeLedger: false });
  assert.deepEqual(schema.schemaBootstrapStatements(), [ledger, ...bootstrap]);
  const client = new DatabaseSync(":memory:");
  try {
    client.exec(ledger);
    client.exec("INSERT INTO migrations VALUES (0, 'exported timestamp')");
    for (const statement of bootstrap) client.exec(statement);
    assert.equal(client.prepare("SELECT applied_at FROM migrations WHERE version = 0").get().applied_at, "exported timestamp");
    assert.equal(await schema.migrate(nodeDatabase(client)), 0);
  } finally {
    client.close();
  }
});
