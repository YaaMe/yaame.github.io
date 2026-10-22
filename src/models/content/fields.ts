// zod comes from the package, not from astro:content — that re-export is
// deprecated in Astro 7. Keep its version range compatible with Astro's own
// zod dependency, so only one copy is installed and a schema written here is
// the schema the content layer runs.
import { z } from "zod";
import { TAG_SLUGS } from "../../config/tags.ts";
import { site } from "../../config/site.config.ts";

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: site.timezone, year: "numeric", month: "2-digit", day: "2-digit",
});

// Must format exactly as post dates are formatted, or a note and a post written
// in the same hour can show different dates.
export function calendarDate(date: Date): { y: string; mo: string; d: string } {
  const [y, mo, d] = ymd.format(date).split("-");
  return { y, mo, d };
}

export function calendarDateLabel(date: { y: string; mo: string; d: string }): string {
  return `${date.y}-${date.mo}-${date.d}`;
}

// Tags must come from the registry in src/config/tags.ts. A typo fails the build
// rather than producing a /tags/xxx/ page nobody will visit.
const tags = z
  .union([z.string(), z.array(z.string()), z.null()])
  .optional()
  .transform((t) => (t == null ? [] : Array.isArray(t) ? t : [t]))
  .pipe(z.array(z.enum(TAG_SLUGS)));

export const stamped = z.coerce.date().transform((d) => {
  return { at: d, ...calendarDate(d), iso: d.toISOString() };
});

export const base = {
  title: z.string(),
  /**
   * Pinned. Stored on the post, so a rename carries it along.
   *
   * Federation serves pinned posts as the actor's `featured` collection. That
   * is the only thing a new visitor sees at once: Mastodon never backfills a
   * remote outbox, but it fetches `featured` when it processes the actor.
   */
  pinned: z.boolean().default(false),
  // Authoring keeps a hand-written description unless the owner requests --force.
  description: z.string().optional(),
  tags,
};
