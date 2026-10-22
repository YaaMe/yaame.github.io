import { commentsFor, type Comment } from "./promoted";
import { withdrawn, withdrawnMany } from "./comments";
import { allNotes, notesForYear } from "../notes";

/** Read the promoted view after applying withdrawals received by the inbox. */
export async function liveCommentsFor(contentId: string): Promise<Comment[]> {
  return commentsFor(contentId, await withdrawn(contentId));
}

/** Read several promoted views after one batched withdrawal lookup. */
export async function liveCommentsForMany(
  contentIds: string[],
): Promise<Map<string, Comment[]>> {
  const withdrawnByRoot = await withdrawnMany(contentIds);
  return new Map(
    await Promise.all(
      contentIds.map(async (contentId) => [
        contentId,
        await commentsFor(contentId, withdrawnByRoot.get(contentId) ?? new Map()),
      ] as const),
    ),
  );
}

export async function liveNoteCommentsForYear(year: string) {
  const notes = notesForYear(await allNotes(), year);
  const comments = await liveCommentsForMany(notes.map((note) => note.id));
  return notes.map((note) => ({ id: note.id, comments: comments.get(note.id) ?? [] }));
}
