import { sql } from "drizzle-orm";
import type { Database } from "../../../platform/types.ts";
import { schemaBootstrapStatements } from "./schema-bootstrap.ts";
import { MIGRATIONS } from "./migration-history.ts";
import { migrations as migrationsLocation } from "../../../config/data.config.generated.mjs";

const migrationsColumns = migrationsLocation;

/**
 * Bring a database up to the current schema.
 *
 * Run here rather than delegated to `wrangler d1 migrations` so both hosts do
 * the same thing: that command exists only on Cloudflare, and a node deployment
 * would otherwise need a second, separately maintained way to the same tables.
 *
 * Idempotent, and one read when there is nothing to do.
 */
export async function migrate(db: Database): Promise<number> {
  await db.run(sql.raw(schemaBootstrapStatements()[0]));

  const rows = await db.all<{ version: number | null }>(
    sql.raw(
      `SELECT MAX(${migrationsColumns.quotedColumns.version}) AS version FROM ${migrationsLocation.table}`,
    ),
  );
  const applied = rows[0]?.version ?? -1;

  let count = 0;
  for (let version = applied + 1; version < MIGRATIONS.length; version++) {
    try {
      await db.atomic([
        `INSERT INTO ${migrationsLocation.table} (${migrationsColumns.quotedColumns.version}, ${migrationsColumns.quotedColumns.appliedAt}) VALUES (${version}, '${new Date().toISOString()}')`,
        ...[MIGRATIONS[version]].flat(),
      ]);
      count++;
    } catch (error) {
      const completed = await db.all(sql`SELECT 1 FROM ${sql.raw(migrationsLocation.table)} WHERE ${sql.raw(migrationsColumns.quotedColumns.version)} = ${version}`);
      if (completed.length === 0) throw error;
    }
  }
  return count;
}
