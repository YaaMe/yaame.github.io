import { AP } from "../../config/activitypub.ts";
import { z } from "zod";
import { contentIdentifier, contentIdentifierOf } from "../activitypub/object-id.ts";
import { CHANNELS, SOURCES, type Source, commentId, deliveryId, identityId, normalizedIdentifier, reactionId, sameOrigin } from "./key-scheme.ts";

export { contentIdentifier } from "../activitypub/object-id.ts";

export const httpUrl = z.url({ protocol: /^https?$/ });
export const internalId = z.uuid({ version: "v5" });
const timestamp = z.iso.datetime();
const source = z.enum([SOURCES.activitypub, SOURCES.github]);

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
      if (comment.replyTo === null && comment.root !== contentIdentifierOf(comment.inReplyTo, AP.actorHost, AP.user)) {
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
    if (reaction.target !== contentIdentifierOf(reaction.objectId, AP.actorHost, AP.user)) throw new Error("a reaction's target must be the content its object URL names");
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * A follower is keyed by the visitor identity id its source and identifier
 * compute, so only that identity's own follow or unfollow reaches the row.
 * The delivery addresses belong to the federated source alone.
 */
export const storedFollowerSchema = z.object({
  id: internalId,
  source,
  identifier: z.string(),
  inbox: httpUrl.nullable(),
  sharedInbox: httpUrl.nullable(),
  followId: httpUrl.nullable(),
  followedAt: timestamp,
}).superRefine(identityReference("id", "follower inputs do not compute its identity id", ["id"])).superRefine((follower, context) => {
  if (follower.source === SOURCES.activitypub) {
    if (follower.inbox === null) context.addIssue({ code: "custom", path: ["inbox"], message: "a federated follower requires its inbox" });
  } else if (follower.inbox !== null || follower.sharedInbox !== null || follower.followId !== null) {
    context.addIssue({ code: "custom", message: "only a federated follower has inbox, sharedInbox and followId" });
  }
});

export const storedDeliverySchema = z.object({
  id: internalId,
  channel: z.enum([CHANNELS.activitypub]),
  target: contentIdentifier,
  enqueuedAt: timestamp,
}).refine((delivery) => delivery.id === deliveryId(delivery.channel, delivery.target), {
  path: ["id"],
  message: "delivery inputs do not compute its id",
});

const recoverySchemas = new Map<string, z.ZodType>([
  ["comments", storedCommentSchema],
  ["followers", storedFollowerSchema],
  ["deliveries", storedDeliverySchema],
  ["visitor-identities", visitorIdentitySchema],
  ["reactions", storedReactionSchema],
  ["migrations", z.object({ version: z.number().int(), appliedAt: z.string() })],
]);

export function validateInteractionRows(kind: string, rows: unknown): void {
  const schema = recoverySchemas.get(kind);
  if (!schema) throw new Error(`No interaction schema for kind: ${kind}`);
  z.array(schema).parse(rows);
}
