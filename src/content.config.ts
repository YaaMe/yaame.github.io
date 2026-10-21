import { defineCollection } from "astro:content";
// zod comes from the package, not from astro:content — that re-export is
// deprecated in Astro 7. Keep its version range compatible with Astro's own
// zod dependency, so only one copy is installed and a schema written here is
// the schema the content layer runs.
import { z } from "zod";
import { glob } from "astro/loaders";
import { TAG_SLUGS } from "./config/tags";
import { site } from "./config/site.config";
import { commentCollectionSchema } from "./selectors/content/collections";
import {
  komorebi as komorebiLocation,
  notes as notesLocation,
  posts as postsLocation,
  promotedComments,
} from "./config/data.config.generated.mjs";

const promotedCommentsGlob = promotedComments.glob;
const notesGlob = notesLocation.glob;
const postsGlob = postsLocation.glob;
const komorebiGlob = komorebiLocation.glob;

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: site.timezone, year: "numeric", month: "2-digit", day: "2-digit",
});

// Tags must come from the registry in src/config/tags.ts. A typo fails the build
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
 * Notes: one JSON file per year, no titles. The body is read as markdown.
 *
 * `id` is separate from the time, because several notes in one day are ordinary
 * and a timestamp cannot be an identity. A note's id must not be date-shaped:
 * a long post's slug is (`2025-year`, `2023-07`), and the two share
 * `/users/…/notes/`, so a date-shaped id could collide with a post.
 */
const notes = defineCollection({
  loader: glob(notesGlob),
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
    loader: glob(promotedCommentsGlob),
    schema: commentCollectionSchema,
  }),
  posts: defineCollection({
    loader: glob(postsGlob),
    schema: z.object({ ...base, date: stamped }),
  }),
  komorebi: defineCollection({
    loader: glob(komorebiGlob),
    schema: z.object({ ...base, date: stamped.optional() }),
  }),
};
