import type { Database } from "../../../platform/types";
import { storedCommentSchema, visitorIdentitySchema } from "../../../lib/interactions/records.ts";
import { comments, visitorIdentities } from "./schema.ts";
import { parseStoredRow } from "./stored-row.ts";

export async function insertComment(db: Database, value: unknown): Promise<boolean> {
  const comment = parseStoredRow(storedCommentSchema, value);
  if (comment === null) return false;
  const author = parseStoredRow(visitorIdentitySchema, {
    id: comment.authorId,
    source: comment.source,
    identifier: comment.identifier,
    name: null,
  });
  if (author === null) return false;
  await db.insert(visitorIdentities).values(author).onConflictDoNothing({ target: visitorIdentities.id });
  const written = await db.insert(comments).values(comment)
    .onConflictDoNothing({ target: comments.id }).returning({ id: comments.id });
  return written.length > 0;
}
