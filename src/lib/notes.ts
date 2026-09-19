import { getCollection } from "astro:content";

/**
 * Notes, archived a file per year and read back as one timeline.
 *
 * Flattening and sorting only: merging with the long posts is the caller's.
 */
export type Note = {
  id: string;
  published: string;
  content: string;
};

/** Newest first, which `OrderedCollection` requires (ActivityPub §5). */
export async function allNotes(): Promise<Note[]> {
  const years = await getCollection("notes");
  return years
    .flatMap((year) => year.data.notes)
    .sort((a, b) => b.published.localeCompare(a.published));
}
