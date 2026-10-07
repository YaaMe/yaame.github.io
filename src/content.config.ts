import { defineCollection } from "astro:content";
// zod comes from the package, not from astro:content — that re-export is
// deprecated in Astro 7. Keep its version range compatible with Astro's own
// zod dependency, so only one copy is installed and a schema written here is
// the schema the content layer runs.
import { z } from "zod";
import { glob } from "astro/loaders";
import { TAG_SLUGS } from "./tags";
import { site } from "./site.config";

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: site.timezone, year: "numeric", month: "2-digit", day: "2-digit",
});

// Tags must come from the registry in src/tags.ts. A typo fails the build
// rather than producing a /tags/xxx/ page nobody will visit.
const tags = z
  .union([z.string(), z.array(z.string()), z.null()])
  .optional()
  .transform((t) => (t == null ? [] : Array.isArray(t) ? t : [t]))
  .pipe(z.array(z.enum(TAG_SLUGS)));

const stamped = z.coerce.date().transform((d) => {
  const [y, mo, day] = ymd.format(d).split("-");
  return { at: d, y, mo, d: day, iso: d.toISOString() };
});

const base = {
  title: z.string(),
  /**
   * Pinned. Stored on the post, so a rename carries it along.
   *
   * Federation serves pinned posts as the actor's `featured` collection. That
   * is the only thing a new visitor sees at once: Mastodon never backfills a
   * remote outbox, but it fetches `featured` when it processes the actor.
   */
  pinned: z.boolean().default(false),
  // Filled in by scripts/frontmatter.mjs. A hand-written value is kept unless
  // that script runs with --force.
  description: z.string().optional(),
  tags,
};

/**
 * Promoted comments — the ones chosen to keep.
 *
 * Read from git, not from the database, so both profiles show the same
 * comments: the static site has no database.
 *
 *   posts/<slug>.json   one file per blog post
 *   notes/<YYYY>.json   one file per year of notes
 *
 * Every entry carries `rootId`, because a yearly file cannot infer it from its
 * name. Both kinds of file share this one schema.
 *
 * When a comment is withdrawn, its entry is removed. The exception is an entry
 * that another entry replies to: it stays as a tombstone, without `content`
 * and with `deletedAt`.
 */
const comment = z.object({
  /**
   * The activity id. Required, not decorative: when a Delete arrives for a
   * comment already carried into git, this is what the removal is raised
   * against.
   */
  activityId: z.url(),
  objectId: z.url(),
  /** The post this hangs off. Redundant in posts/, load-bearing in notes/. */
  rootId: z.url(),
  actorId: z.url(),
  /**
   * What the author called themselves when this was promoted.
   *
   * A copy: the author can change their name, and this will not follow.
   * Absent when the actor could not be reached at promotion; the page then
   * shows the `@name@host` handle instead.
   */
  name: z.string().optional(),
  /**
   * Plain text, not HTML — extracted from the sender's markup on promotion.
   * See docs/decisions/0006-promoted-comments-are-stored-as-text.md.
   *
   * Absent on a tombstone: a withdrawn comment that something replies to.
   */
  content: z.string().optional(),
  published: z.string(),
  replyToId: z.url().nullable().default(null),
  /** Set when a Delete arrived after this was promoted. */
  deletedAt: z.string().optional(),
});

/**
 * Notes: one JSON file per year, no titles. The body is read as markdown.
 *
 * `id` is separate from the time, because several notes in one day are ordinary
 * and a timestamp cannot be an identity. A note's id must not be date-shaped:
 * a long post's slug is (`2025-year`, `2023-07`), and the two share
 * `/users/…/notes/`, so a date-shaped id could collide with a post.
 */
const notes = defineCollection({
  loader: glob({ base: "./src/content/notes", pattern: "**/*.json" }),
  schema: z.object({
    notes: z.array(
      z.object({
        id: z.string().regex(/^[a-z0-9]{6,12}$/, "短随机串，不要日期形状"),
        published: z.string(),
        content: z.string(),
      }),
    ),
  }),
});

export const collections = {
  notes,
  comments: defineCollection({
    loader: glob({ base: "./src/content/comments", pattern: "**/*.json" }),
    schema: z.object({ comments: z.array(comment) }),
  }),
  posts: defineCollection({
    loader: glob({ base: "./src/content/posts", pattern: "**/*.md" }),
    schema: z.object({ ...base, date: stamped }),
  }),
  komorebi: defineCollection({
    loader: glob({ base: "./src/content/komorebi", pattern: "**/*.md" }),
    // `type` is a Hexo field. It is accepted and never read; no entry sets it.
    schema: z.object({ ...base, date: stamped.optional(), type: z.any().optional() }),
  }),
};
