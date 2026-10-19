import { z } from "zod";
import { AP } from "../../integrations/activitypub/config.ts";
import { SOURCES, type Source, commentId, identityId, normalizedIdentifier, normalizedUrl, reactionId, sameOrigin } from "./key-scheme.ts";

export const httpUrl = z.url({ protocol: /^https?$/ });
export const internalId = z.uuid({ version: "v5" });
export const contentIdentifier = z.string().min(1).regex(/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u);
const timestamp = z.iso.datetime();
const source = z.enum([SOURCES.activitypub, SOURCES.github]);

// The path of the Note object dispatcher's route. Changing that route without
// this prefix stops every reply and reaction from finding its content.
const CONTENT_PREFIX = `https://${AP.actorHost}/users/${AP.user}/notes/`;

/**
 * The site's content identifier a federated object URL names, or null when it names none.
 *
 * A prefix test, not a lookup: asking the content layer would pull
 * `astro:content` into the queue consumer, which cannot resolve it.
 */
export function contentIdentifierOf(url: string): string | null {
  let identifier: string;
  try {
    const href = normalizedUrl(url);
    if (!href.startsWith(CONTENT_PREFIX)) return null;
    identifier = decodeURIComponent(href.slice(CONTENT_PREFIX.length));
  } catch {
    return null;
  }
  return contentIdentifier.safeParse(identifier).success ? identifier : null;
}

/**
 * The stored identity id in `field` must be the one its source and identifier
 * compute. A federated identifier is stored as the inbox receives it, normalised;
 * a GitHub identifier keeps its raw form.
 */
function identityReference<T extends { source: Source; identifier: string }>(
  field: keyof T & string,
  message: string,
  path: string[] = [],
) {
  return (value: T, context: z.RefinementCtx) => {
    let matches = false;
    try {
      matches = value[field] === identityId(value.source, value.identifier);
    } catch {}
    if (!matches) context.addIssue({ code: "custom", path, message });
    else if (value.source === SOURCES.activitypub && value.identifier !== normalizedIdentifier(value.source, value.identifier)) {
      context.addIssue({ code: "custom", path: ["identifier"], message: "a federated identifier must be stored normalised" });
    }
  };
}

export const visitorIdentitySchema = z.object({
  id: internalId,
  source,
  identifier: z.string(),
  name: z.string().nullable(),
}).superRefine(identityReference("id", "visitor identity inputs do not compute its id", ["id"]));

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
  published: timestamp,
  receivedAt: timestamp,
  deletedAt: timestamp.nullable(),
  promotedAt: timestamp.nullable(),
}).superRefine(identityReference("authorId", "comment author inputs do not compute its identity id")).superRefine((comment, context) => {
  try {
    normalizedIdentifier(comment.source, comment.identifier);
    if (comment.id !== commentId(comment)) throw new Error("comment inputs do not compute its id");
    if (comment.source === SOURCES.activitypub) {
      if (comment.activityId === null || comment.objectId === null || comment.inReplyTo === null || comment.submissionId !== null) {
        throw new Error("a federated comment requires activityId, objectId and inReplyTo, and no submissionId");
      }
      if (!sameOrigin(comment.identifier, comment.activityId, comment.objectId)) throw new Error("federated attributes must share the signing actor's origin");
      if (comment.replyTo === null && comment.root !== contentIdentifierOf(comment.inReplyTo)) {
        throw new Error("a reply to the site's content must have that content as its root");
      }
    } else if (comment.activityId !== null || comment.objectId !== null || comment.inReplyTo !== null || comment.submissionId === null) {
      throw new Error("a GitHub comment requires a submissionId and no federated attributes");
    }
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
  }
});

export const REACTION_KINDS = ["Announce", "Like"] as const;

export const storedReactionSchema = z.object({
  id: internalId,
  source,
  identifier: z.string(),
  authorId: internalId,
  activityId: httpUrl,
  objectId: httpUrl,
  target: contentIdentifier,
  kind: z.enum(REACTION_KINDS),
  receivedAt: timestamp,
  undoneAt: timestamp.nullable(),
}).superRefine(identityReference("authorId", "reaction author inputs do not compute its identity id")).superRefine((reaction, context) => {
  try {
    if (reaction.id !== reactionId(reaction)) throw new Error("reaction inputs do not compute its id");
    if (!sameOrigin(reaction.identifier, reaction.activityId)) throw new Error("a reaction's activity must share the signing actor's origin");
    if (reaction.target !== contentIdentifierOf(reaction.objectId)) throw new Error("a reaction's target must be the content its object URL names");
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
  }
});

const recoverySchemas = new Map<string, z.ZodType>([
  ["comments", storedCommentSchema],
  ["visitor-identities", visitorIdentitySchema],
  ["reactions", storedReactionSchema],
  ["migrations", z.object({ version: z.number().int(), appliedAt: z.string() })],
]);

/**
 * Every reference between interaction rows must resolve inside the same set:
 * a comment's or reaction's author is a visitor identity in it, and a
 * comment's replyTo is a comment in it. The database enforces no foreign
 * keys, so a restore that skipped this would leave rows pointing at nothing.
 * Takes rows already accepted by validateInteractionRows.
 */
export function validateInteractionReferences(rowsByKind: ReadonlyMap<string, readonly unknown[]>): void {
  const rows = (kind: string) => (rowsByKind.get(kind) ?? []) as Array<Record<string, unknown>>;
  const identities = new Set(rows("visitor-identities").map((identity) => identity.id));
  const comments = new Set(rows("comments").map((comment) => comment.id));
  for (const kind of ["comments", "reactions"]) {
    for (const row of rows(kind)) {
      if (!identities.has(row.authorId)) {
        throw new Error(`${kind} ${String(row.id)} names author ${String(row.authorId)}, which is not among the visitor identities`);
      }
      if (kind === "comments" && row.replyTo !== null && !comments.has(row.replyTo)) {
        throw new Error(`comments ${String(row.id)} replies to ${String(row.replyTo)}, which is not among the comments`);
      }
    }
  }
}

export function validateInteractionRows(kind: string, rows: unknown): void {
  const schema = recoverySchemas.get(kind);
  if (!schema) throw new Error(`No interaction schema for kind: ${kind}`);
  z.array(schema).parse(rows);
}
