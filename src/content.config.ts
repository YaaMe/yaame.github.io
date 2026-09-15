import { defineCollection, z } from "astro:content";
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
  // Filled in by scripts/frontmatter.mjs; hand-written values are never overwritten
  description: z.string().optional(),
  tags,
};

export const collections = {
  posts: defineCollection({
    loader: glob({ base: "./src/content/posts", pattern: "**/*.md" }),
    schema: z.object({ ...base, date: stamped }),
  }),
  komorebi: defineCollection({
    loader: glob({ base: "./src/content/komorebi", pattern: "**/*.md" }),
    // index.md still carries a leftover Hexo `type` field: accepted, unused
    schema: z.object({ ...base, date: stamped.optional(), type: z.any().optional() }),
  }),
};
