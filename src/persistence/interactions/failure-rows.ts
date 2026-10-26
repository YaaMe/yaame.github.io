/**
 * Failure rows against a given database: the only file that queries the
 * failures table.
 *
 * Every write is one upsert on the row's own (kind, subject). Reading rows,
 * merging and writing them back would lose whatever a concurrent writer or a
 * stale read missed.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../../platform/types";
import { failures as location } from "../../config/data.config.generated.mjs";
import { type FailureKind, type StoredFailure, parseStoredFailure } from "../../models/interactions/failures.ts";
import { failures } from "../../models/interactions/tables.ts";

const column = (name: keyof typeof location.quotedColumns) => sql.raw(location.quotedColumns[name]);

/** Insert, or replace the held row only when this observation is later. */
export async function upsertFailure(db: Database, value: unknown): Promise<void> {
  const row = parseStoredFailure(value);
  await db.insert(failures).values({ ...row, data: JSON.stringify(row.data) }).onConflictDoUpdate({
    target: [failures.kind, failures.subject],
    set: { at: sql`excluded.${column("at")}`, data: sql`excluded.${column("data")}` },
    setWhere: sql`excluded.${column("at")} > ${failures.at}`,
  });
}

/** One kind's rows. A row its schema refuses is reported by id, never by content. */
export async function failureRows(db: Database, kind: FailureKind): Promise<StoredFailure[]> {
  const rows = await db.select().from(failures).where(eq(failures.kind, kind)).orderBy(asc(failures.subject));
  return rows.map((stored) => {
    try {
      return parseStoredFailure({ ...stored, data: JSON.parse(stored.data) });
    } catch {
      throw new Error(`stored failure ${stored.id} does not match its schema`);
    }
  });
}
