import type { z } from "zod";
import type { commentSchema } from "../../models/content/comments.ts";
import { contentIdentifier } from "../../models/interactions/records.ts";

export type ArchivedComment = z.infer<typeof commentSchema>;
export type ArchiveDocument = { comments: ArchivedComment[]; [key: string]: unknown };
export type ArchiveSnapshot = { path: string; document: ArchiveDocument };
export type ArchiveWrite = { path: string; before: ArchiveDocument; after: ArchiveDocument };
export type NoteSnapshot = { name: string; document: { notes: Array<{ id: string }> } };

export function entryFor(document: ArchiveDocument | undefined, id: string) {
  return document?.comments?.find((entry) => entry.id === id);
}

export function locate(documents: ArchiveSnapshot[], id: string) {
  for (const { path, document } of documents) {
    const index = document?.comments?.findIndex((entry) => entry.id === id) ?? -1;
    if (index >= 0) return { path, document, index };
  }
  return undefined;
}

export function archivePath(root: string, notes: Iterable<NoteSnapshot>) {
  if (!contentIdentifier.safeParse(root).success) return null;
  for (const { name, document } of notes) {
    if (document.notes.some((note) => note.id === root)) return ["notes", `${name.slice(0, -5)}.json`];
  }
  return postArchivePath(root);
}

export function postArchivePath(slug: string) {
  contentIdentifier.parse(slug);
  return ["posts", `${slug}.json`];
}
