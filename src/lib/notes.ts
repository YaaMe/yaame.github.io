import { getCollection } from "astro:content";
import { marked } from "marked";

/**
 * Notes, archived a file per year and read back as one stream.
 *
 * `year` is the archive it came from, not a year derived from `published`.
 * The two can disagree: a note written just after local midnight on 1 January
 * carries a UTC timestamp from the year before. Only the file is authoritative,
 * because the file is what the permalink is built from.
 */
export type Note = {
  id: string;
  published: string;
  content: string;
  year: string;
};

/** Newest first, which `OrderedCollection` requires (ActivityPub §5). */
export async function allNotes(): Promise<Note[]> {
  const years = await getCollection("notes");
  return years
    .flatMap((year) => year.data.notes.map((n) => ({ ...n, year: year.id })))
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
