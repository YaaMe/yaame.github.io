import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import type { Database } from "../../platform/types";
import { comments, reactions, visitorIdentities } from "../../models/interactions/tables.ts";
import { storedIdentity } from "../../models/interactions/identity.ts";

/**
 * Write the identity a validated row names, then the row.
 *
 * Two statements, not one batch, so a failed row write can leave its identity
 * behind. False when the identity is refused, before anything is written, or
 * when the row's id is already held; a held identity or row is left as it is.
 */
export function insertWithIdentity(db: Database, table: typeof comments, row: typeof comments.$inferInsert): Promise<boolean>;
export function insertWithIdentity(db: Database, table: typeof reactions, row: typeof reactions.$inferInsert): Promise<boolean>;
export async function insertWithIdentity(
  db: Database,
  // biome-ignore lint/suspicious/noExplicitAny: each overload above pairs a table with its own row type
  table: SQLiteTableWithColumns<any>,
  row: { authorId: string; source: string; identifier: string },
): Promise<boolean> {
  const author = storedIdentity(row.authorId, row);
  if (author === null) return false;
  await db.insert(visitorIdentities).values(author).onConflictDoNothing({ target: visitorIdentities.id });
  const written = await db.insert(table).values(row)
    .onConflictDoNothing({ target: table.id }).returning({ id: table.id });
  return written.length > 0;
}
