import { eq } from "drizzle-orm";
import type { Database } from "../../../platform/types";
import { storedCommentSchema } from "../../../lib/interactions/records.ts";
import { insertWithIdentity } from "./identity-write.ts";
import { comments } from "./tables.ts";
import { parseStoredRow } from "./stored-row.ts";

export async function insertComment(db: Database, value: unknown): Promise<boolean> {
  const comment = parseStoredRow(storedCommentSchema, value);
  if (comment === null) return false;
  return insertWithIdentity(db, comments, comment);
}

export async function withdrawComment(db: Database, id: string, deletedAt: string): Promise<boolean> {
  const changed = await db
    .update(comments)
    .set({ deletedAt, content: "" })
    .where(eq(comments.id, id))
    .returning({ id: comments.id });
  return changed.length > 0;
}
