import { readNotes } from "../persistence/content/notes";
import { marked } from "marked";
import { calendarDate, calendarDateLabel } from "../models/content/fields";
import { site } from "../config/site.config";

/**
 * Notes, archived a file per year and read back as one stream.
 *
 * `published` is stored UTC, the only form that sorts by string comparison,
 * and everything a reader sees is rendered in the site's timezone instead.
 *
 * `year` is the archive the note came from, and the writer files by the UTC
 * year rather than that timezone — the address must not depend on a setting
 * that can be edited. The two therefore disagree for a note written in the
 * first hours of 1 January local time: it shows next year's date while living
 * in this year's archive. See docs/decisions/0009.
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
  const years = await readNotes();
  return years
    .flatMap((year) =>
      year.data.notes.map((n) => {
        return { ...n, year: year.id, date: calendarDate(new Date(n.published)) };
      }),
    )
    .sort((a, b) => b.published.localeCompare(a.published));
}

/** The archive years, newest first. */
export async function noteYears(): Promise<string[]> {
  return (await readNotes()).map((y) => y.id).sort((a, b) => b.localeCompare(a));
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
 * A note's markup, for both the page and federation.
 *
 * A second conversion anywhere would let a remote copy disagree with ours
 * about our own words.
 */
export function noteHtml(n: Note): string {
  return marked.parse(n.content, { async: false }) as string;
}

export function noteYearHref(year: string) {
  return `/notes/${year}/`;
}

export function notesForYear(notes: Note[], year: string): Note[] {
  return notes.filter((note) => note.year === year);
}

export function noteDisplay(note: Note) {
  return {
    id: note.id,
    href: noteHref(note),
    published: note.published,
    date: calendarDateLabel(note.date),
    html: noteHtml(note),
  };
}

export function noteYearPage(notes: Note[], year: string) {
  return { title: `notes ${year}`, year, notes: notesForYear(notes, year), backHref: "/notes/" };
}

export async function latestNotesPage() {
  const notes = await allNotes();
  const years = await noteYears();
  const shown = notes.slice(0, 20);
  return {
    title: `notes · ${site.title}`,
    notes: shown,
    empty: notes.length === 0,
    archived: years.length > 1 || notes.length > shown.length,
    years: years.map((year) => ({ label: year, href: noteYearHref(year) })),
  };
}
