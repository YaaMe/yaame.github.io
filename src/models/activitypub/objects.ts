/**
 * One item on the timeline.
 *
 * A long post becomes a note once it is rendered down to title, description and
 * link, so this is one collection rather than two.
 */
export type Item = {
  slug: string;
  published: string;
  /** Already HTML. */
  content: string;
  /** Where a person reads it. */
  url: URL;
};

export type Tally = { replies: number; likes: number; shares: number };
