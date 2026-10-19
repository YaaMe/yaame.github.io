import { z } from "zod";
import { SOURCES } from "./key-scheme.ts";
import { contentIdentifier, httpUrl, internalId, storedCommentSchema, visitorIdentitySchema } from "./records.ts";

export const commentHref = httpUrl;
export const commentRun = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("link"), href: commentHref, label: z.string() }),
  z.object({ type: z.literal("mention"), href: commentHref, handle: z.string() }),
  z.object({ type: z.literal("hashtag"), href: commentHref, name: z.string() }),
]);

export const commentSchema = z.discriminatedUnion("source", [
  z.object({
    id: internalId,
    source: z.literal(SOURCES.activitypub),
    activityId: commentHref,
    objectId: commentHref,
    inReplyTo: commentHref,
    root: contentIdentifier,
    replyTo: internalId.nullable().default(null),
    author: z.object({
      id: internalId,
      source: z.literal(SOURCES.activitypub),
      identifier: commentHref,
      name: z.string().optional(),
    }),
    content: z.array(z.array(commentRun)).optional(),
    published: z.string(),
    deletedAt: z.string().optional(),
  }).strict(),
]).superRefine((entry, context) => {
  if (entry.deletedAt !== undefined && entry.content !== undefined) {
    context.addIssue({ code: "custom", path: ["content"], message: "A withdrawn comment must have no content" });
  }
  const author = visitorIdentitySchema.safeParse({ ...entry.author, name: entry.author.name ?? null });
  if (!author.success) {
    for (const issue of author.error.issues) context.addIssue({ ...issue, path: ["author", ...issue.path] });
  }
  const record = storedCommentSchema.safeParse({
    ...entry,
    identifier: entry.author.identifier,
    authorId: entry.author.id,
    submissionId: null,
    content: "",
    receivedAt: entry.published,
    deletedAt: entry.deletedAt ?? null,
    promotedAt: null,
  });
  if (!record.success) {
    for (const issue of record.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});
