import { z } from "zod";

/**
 * Notes: one JSON file per year, no titles. The body is read as markdown.
 *
 * `id` is separate from the time, because several notes in one day are ordinary
 * and a timestamp cannot be an identity. A note's id must not be date-shaped:
 * a long post's slug is (`2025-year`, `2023-07`), and the two share
 * `/users/…/notes/`, so a date-shaped id could collide with a post.
 */
export const noteCollectionSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9]{6,12}$/, "短随机串，不要日期形状"),
      published: z.string(),
      content: z.string(),
    }),
  ),
});
