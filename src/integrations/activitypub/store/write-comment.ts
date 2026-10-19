import type { Database } from "../../../platform/types";
import { storedCommentSchema, visitorIdentitySchema } from "../../../lib/interactions/records.ts";
import { comments, visitorIdentities } from "./schema.ts";

export async function insertComment(db: Database, value: unknown): Promise<boolean> {
  const comment = storedCommentSchema.safeParse(value);
  if (!comment.success) return false;
  const author = visitorIdentitySchema.safeParse({
    id: comment.data.authorId,
    source: comment.data.source,
    identifier: comment.data.identifier,
    name: null,
  });
  if (!author.success) return false;
  await db.insert(visitorIdentities).values(author.data).onConflictDoNothing({ target: visitorIdentities.id });
  const written = await db.insert(comments).values(comment.data)
    .onConflictDoNothing({ target: comments.id }).returning({ id: comments.id });
  return written.length > 0;
}
