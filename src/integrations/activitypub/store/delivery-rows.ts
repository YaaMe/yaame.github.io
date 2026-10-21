/**
 * Delivery marks against a given database: the only file that queries the
 * deliveries table.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../../../platform/types";
import type { Channel } from "../../../lib/interactions/key-scheme.ts";
import { deliveries as location } from "../../../config/data.config.generated.mjs";
import { deliveries } from "./tables.ts";
import { sqlValue } from "./sql-text.ts";
import type { Delivery } from "./delivery.ts";

/** One channel's marks; another channel's rows say nothing about this one. */
export async function enqueuedTargets(db: Database, channel: Channel): Promise<Set<string>> {
  const rows = await db.select({ target: deliveries.target }).from(deliveries).where(eq(deliveries.channel, channel));
  return new Set(rows.map(({ target }) => target));
}

/**
 * Idempotent: a mark already held is left as it was.
 *
 * All or nothing. The first run marks the whole archive, and a partial mark
 * leaves a table that is no longer empty, so the next build would send every
 * post the failure skipped. One atomic batch, so no bound-parameter limit
 * splits it.
 */
export async function markEnqueued(db: Database, rows: readonly Delivery[]): Promise<void> {
  const columns = location.quotedColumns;
  await db.atomic(rows.map((row) =>
    `INSERT INTO ${location.table} (${columns.id}, ${columns.channel}, ${columns.target}, ${columns.enqueuedAt}) VALUES (${
      [row.id, row.channel, row.target, row.enqueuedAt].map(sqlValue).join(", ")}) ON CONFLICT (${columns.id}) DO NOTHING`));
}
