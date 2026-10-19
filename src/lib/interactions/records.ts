import { z } from "zod";
import { SOURCES, commentId, identityId, normalizedIdentifier, sameOrigin } from "./key-scheme.ts";

export const httpUrl = z.url({ protocol: /^https?$/ });
export const internalId = z.uuid({ version: "v5" });
export const contentIdentifier = z.string().min(1).regex(/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u);
const source = z.enum([SOURCES.activitypub, SOURCES.github]);

export const visitorIdentitySchema = z.object({
  id: internalId,
  source,
  identifier: z.string(),
  name: z.string().nullable(),
}).superRefine((identity, context) => {
  try {
    if (identity.id === identityId(identity.source, identity.identifier)) return;
  } catch {}
  context.addIssue({ code: "custom", path: ["id"], message: "visitor identity inputs do not compute its id" });
});

export const storedCommentSchema = z.object({
  id: internalId,
  source,
  identifier: z.string(),
  authorId: internalId,
  activityId: httpUrl.nullable(),
  objectId: httpUrl.nullable(),
  submissionId: z.uuid().nullable(),
  inReplyTo: httpUrl.nullable(),
  root: contentIdentifier,
  replyTo: internalId.nullable(),
  content: z.string(),
  published: z.string(),
  receivedAt: z.string(),
  deletedAt: z.string().nullable(),
  promotedAt: z.string().nullable(),
}).superRefine((comment, context) => {
  try {
    normalizedIdentifier(comment.source, comment.identifier);
    if (comment.id !== commentId(comment)) throw new Error("comment inputs do not compute its id");
    if (comment.authorId !== identityId(comment.source, comment.identifier)) throw new Error("comment author inputs do not compute its identity id");
    if (comment.source === SOURCES.activitypub) {
      if (comment.activityId === null || comment.objectId === null || comment.inReplyTo === null || comment.submissionId !== null) {
        throw new Error("a federated comment requires activityId, objectId and inReplyTo, and no submissionId");
      }
      if (!sameOrigin(comment.identifier, comment.activityId, comment.objectId)) throw new Error("federated attributes must share the signing actor's origin");
    } else if (comment.activityId !== null || comment.objectId !== null || comment.inReplyTo !== null || comment.submissionId === null) {
      throw new Error("a GitHub comment requires a submissionId and no federated attributes");
    }
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
  }
});

const recoverySchemas = new Map<string, z.ZodType>([
  ["comments", storedCommentSchema],
  ["visitor-identities", visitorIdentitySchema],
  ["reactions", z.object({
    activityId: z.string(),
    objectId: z.string(),
    actorId: z.string(),
    kind: z.string(),
    receivedAt: z.string(),
    undoneAt: z.string().nullable(),
  })],
  ["migrations", z.object({ version: z.number().int(), appliedAt: z.string() })],
]);

export function validateInteractionRows(kind: string, rows: unknown): void {
  const schema = recoverySchemas.get(kind);
  if (!schema) throw new Error(`No interaction schema for kind: ${kind}`);
  z.array(schema).parse(rows);
}
