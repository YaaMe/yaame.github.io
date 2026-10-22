import { commentCollectionSchema } from "../../models/content/comments.ts";
import type { ArchiveDocument } from "../../selectors/interactions/comment-archive.ts";

export function archiveWrite(document: ArchiveDocument) {
  // An empty file describes a conversation that is not there.
  if ((document.comments ?? []).length === 0) return { remove: true };
  commentCollectionSchema.parse(document);
  return { remove: false };
}
