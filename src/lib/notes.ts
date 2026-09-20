import { getCollection } from "astro:content";
import { marked } from "marked";
import { site } from "../site.config";

// Same formatter the posts use, so a note and a post written in the same hour
// never show different dates.
const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: site.timezone, year: "numeric", month: "2-digit", day: "2-digit",
});

/**
 * Notes, archived a file per year and read back as one stream.
 *
 * `published` is stored UTC, which is the only form that sorts by string
 * comparison; everything a reader sees is rendered in the site's timezone
 * instead. `year` is the archive the note came from, and the writer files it by
 * that same timezone — so the date on the page and the archive holding it never
 * disagree, which they would at either end of a year if one of them used UTC.
 */
export type Note = {
  id: string;
  published: string;
  content: string;
  year: string;
  /** Rendered in `site.timezone`, like a post's. */
  date: { y: string; mo: string; d: string };
};

/** Newest first, which `OrderedCollection` requires (ActivityPub §5). */
export async function allNotes(): Promise<Note[]> {
  const years = await getCollection("notes");
  return years
    .flatMap((year) =>
      year.data.notes.map((n) => {
        const [y, mo, d] = ymd.format(new Date(n.published)).split("-");
        return { ...n, year: year.id, date: { y, mo, d } };
      }),
    )
    .sort((a, b) => b.published.localeCompare(a.published));
}

/** The archive years, newest first. */
export async function noteYears(): Promise<string[]> {
  return (await getCollection("notes")).map((y) => y.id).sort((a, b) => b.localeCompare(a));
}

/**
 * URL contract: /notes/{year}/#{id}.
 *
 * This address is what the federated `url` carries, so it is in other people's
 * databases and cannot be taken back. An anchor on a year archive survives
 * everything that is going to happen to this content — appending to a year
 * never moves what is already in it.
 *
 * See docs/decisions/0009-note-urls-are-a-year-archive-and-an-anchor.md.
 */
export function noteHref(n: Note) {
  return `/notes/${n.year}/#${n.id}`;
}

/**
 * A note's markup, defined once for the page and for delivery.
 *
 * Two conversions would be two definitions of what a note is, and the drift
 * would show as a remote copy that disagrees with ours about our own words.
 */
export function noteHtml(n: Note): string {
  return marked.parse(n.content, { async: false }) as string;
}
