import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { TAG_SLUGS } from "./tags";

// The site's publishing timezone. Frontmatter dates carry +08:00, but the
// /YYYY/MM/DD/ segments must be rendered in THIS zone: rendered as UTC,
// a 02:22+08:00 timestamp falls back a day and breaks the URL contract.
const TZ = "Asia/Shanghai";
const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
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
