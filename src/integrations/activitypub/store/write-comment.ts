import type { Database } from "../../../platform/types";
import { storedCommentSchema } from "../../../lib/interactions/records.ts";
import { insertWithIdentity } from "./identity-write.ts";
import { comments } from "./schema.ts";
import { parseStoredRow } from "./stored-row.ts";

export async function insertComment(db: Database, value: unknown): Promise<boolean> {
  const comment = parseStoredRow(storedCommentSchema, value);
  if (comment === null) return false;
  return insertWithIdentity(db, comments, comment);
}
