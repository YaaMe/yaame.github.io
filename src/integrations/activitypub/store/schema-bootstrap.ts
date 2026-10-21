import { MIGRATIONS } from "./migration-history.ts";
import { migrations as migrationsLocation } from "../../../config/data.config.generated.mjs";

const migrationsColumns = migrationsLocation;

/**
 * Requires an empty application schema: every migration must accept empty tables.
 * Record all versions so migrate() cannot replay non-idempotent migrations.
 * Recovery may preload exported version rows to preserve their timestamps.
 */
export function schemaBootstrapStatements(): string[] {
  const appliedAt = new Date().toISOString();
  return [
    `CREATE TABLE IF NOT EXISTS ${migrationsLocation.table} (${migrationsColumns.quotedColumns.version} INTEGER PRIMARY KEY, ${migrationsColumns.quotedColumns.appliedAt} TEXT NOT NULL)`,
    ...MIGRATIONS.flat(),
    ...MIGRATIONS.map((_migration, version) =>
      `INSERT OR IGNORE INTO ${migrationsLocation.table} (${migrationsColumns.quotedColumns.version}, ${migrationsColumns.quotedColumns.appliedAt}) VALUES (${version}, '${appliedAt}')`,
    ),
  ];
}
