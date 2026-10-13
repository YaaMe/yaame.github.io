#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
assert.deepEqual(argv.slice(0, 4), ["--no-install", "wrangler", "d1", "execute"]);
assert.ok(argv.includes("--remote") && argv.includes("--json"));
const config = JSON.parse(readFileSync(argv[argv.indexOf("--config") + 1], "utf8"));
assert.equal(config.d1_databases[0].database_id, "fixture-d1");
const importing = argv.includes("--file");
const sql = importing
  ? readFileSync(argv[argv.indexOf("--file") + 1], "utf8")
  : argv[argv.indexOf("--command") + 1];
appendFileSync(process.env.FAKE_D1_CALLS, JSON.stringify({ importing, sql, config }) + "\n");
const database = new DatabaseSync(process.env.FAKE_D1_DATABASE, { readOnly: !importing });
try {
  if (importing) {
    assert.ok(argv.includes("--yes"));
    if (process.env.FAKE_D1_RACE) {
      database.exec("CREATE TABLE concurrent_writer (value TEXT); INSERT INTO concurrent_writer VALUES ('preserve')");
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    if (process.env.FAKE_D1_LOST_ACK) {
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify([{ results: [{ "Total queries executed": 1 }], success: true }]));
    }
  } else {
    const results = [];
    let remaining = sql.trim();
    while (remaining) {
      const statement = database.prepare(remaining);
      results.push({ results: statement.all(), success: true });
      remaining = remaining.slice(statement.sourceSQL.length).trim();
    }
    if (process.env.FAKE_D1_RESPONSE === "missing") results.pop();
    if (process.env.FAKE_D1_RESPONSE === "failed") results[0].success = false;
    if (process.env.FAKE_D1_RESPONSE === "malformed") delete results[0].results;
    console.log(process.env.FAKE_D1_RESPONSE === "invalid-json" ? "not JSON" : JSON.stringify(results));
  }
} finally {
  database.close();
  const configPath = argv[argv.indexOf("--config") + 1];
  if (process.env.FAKE_D1_CLEANUP === "unlink") {
    unlinkSync(configPath);
    mkdirSync(configPath);
  } else if (process.env.FAKE_D1_CLEANUP === "rmdir") {
    mkdirSync(join(dirname(configPath), "cleanup-obstruction"));
  } else if (process.env.FAKE_D1_CLEANUP === "import-unlink" && importing) {
    const importPath = argv[argv.indexOf("--file") + 1];
    renameSync(importPath, `${importPath}.retained`);
    mkdirSync(importPath);
  }
}
