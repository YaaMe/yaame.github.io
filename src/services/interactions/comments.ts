import { commentHref } from "../../models/content/comments.ts";
import { SOURCES, commentId, identityId } from "../../models/interactions/key-scheme.ts";
import { store } from "../../persistence/interactions/database.ts";
import { insertComment, withdrawComment } from "../../persistence/interactions/write-comment.ts";
import { rootOf } from "../../selectors/interactions/comments.ts";

/**
 * Record a reply.
 *
 * False when it was not stored — a reply to something that is not ours, or one
 * already held. The primary key identifies the Note and its signing actor,
 * so redelivery in a new Create also leaves the stored comment unchanged.
 */
export async function record(
  reply: {
    activityId: string;
    objectId: string;
    inReplyTo: string;
    actorId: string;
    content: string;
    published: string;
  },
  ours: (id: string) => string | null,
): Promise<boolean> {
  const db = await store();
  const thread = await rootOf(db, reply.inReplyTo, ours);
  if (thread === null) return false;
  const inputs = { source: SOURCES.activitypub, identifier: reply.actorId, objectId: reply.objectId };
  let id: string;
  let authorId: string;
  try {
    id = commentId(inputs);
    authorId = identityId(inputs.source, inputs.identifier);
  } catch {
    return false;
  }
  return insertComment(db, {
    ...inputs,
    id,
    authorId,
    activityId: reply.activityId,
    inReplyTo: reply.inReplyTo,
    submissionId: null,
    ...thread,
    content: reply.content,
    published: reply.published,
    receivedAt: new Date().toISOString(),
    deletedAt: null,
    promotedAt: null,
  });
}

/**
 * Mark a comment deleted.
 *
 * The row stays. We still owe a record of what was here — and if the comment was
 * carried into git, the removal there is raised against this row.
 */
export async function remove(objectId: string, actorId: string): Promise<boolean> {
  if (!commentHref.safeParse(objectId).success || !commentHref.safeParse(actorId).success) return false;
  const db = await store();
  return withdrawComment(db, commentId({ source: SOURCES.activitypub, identifier: actorId, objectId }), new Date().toISOString());
}
