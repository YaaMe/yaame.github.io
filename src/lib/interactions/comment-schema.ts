import { z } from "zod";

export const commentHref = z.url({ protocol: /^https?$/ });
export const commentRun = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("link"), href: commentHref, label: z.string() }),
  z.object({ type: z.literal("mention"), href: commentHref, handle: z.string() }),
  z.object({ type: z.literal("hashtag"), href: commentHref, name: z.string() }),
]);

/**
 * Promoted comments — the ones chosen to keep.
 *
 * Promoted records live in git. The static profile reads them alone; the full
 * profile also reads current withdrawal ids from its database.
 *
 *   posts/<slug>.json   one file per long post
 *   notes/<YYYY>.json   one file per note archive year
 *
 * Every entry carries `rootId`, because a yearly file cannot infer it from its
 * name. Both kinds of file share this one schema.
 *
 * When a comment is withdrawn, its entry is removed. The exception is an entry
 * that another entry replies to: it stays as a tombstone, without `content`
 * and with `deletedAt`.
 */
export const commentSchema = z.object({
  // Required, not decorative: reconciliation identifies an entry by this id.
  activityId: commentHref,
  objectId: commentHref,
  rootId: commentHref,
  actorId: commentHref,
  // A copy of the actor's name; it will not follow future profile changes.
  name: z.string().optional(),
  // Structured runs, never HTML: promotion is not a sanitiser.
  content: z.array(z.array(commentRun)).optional(),
  published: z.string(),
  replyToId: commentHref.nullable().default(null),
  deletedAt: z.string().optional(),
}).refine((entry) => entry.deletedAt === undefined || entry.content === undefined, {
  message: "A withdrawn comment must have no content",
  path: ["content"],
});
