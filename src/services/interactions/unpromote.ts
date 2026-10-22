import { rowValue, type CommentRow } from "../../persistence/interactions/comment-rows.ts";
import { locate, type ArchiveSnapshot } from "../../selectors/interactions/comment-archive.ts";
export { selectSql, deleteSql } from "../../persistence/interactions/comment-operation-sql.ts";
export { rowValue } from "../../persistence/interactions/comment-rows.ts";

export function planUnpromotion({ id, rows, documents }: {
  id: string; rows: CommentRow[]; documents: ArchiveSnapshot[];
}) {
  const row = rows.find((candidate) => rowValue(candidate, "id") === id);
  const located = locate(documents, id);
  const entry = located?.document.comments[located.index];

  if (!row && !located) {
    throw new Error(`Not a promoted comment: ${id} is in neither the archive nor D1`);
  }
  const archive = located
    ? { present: true, path: located.path, entry }
    : { present: false };
  const d1 = row ? { present: true, id } : { present: false };
  return {
    archive,
    d1,
    entry,
    row,
    write: located ? {
      path: located.path,
      after: {
        ...located.document,
        comments: located.document.comments.filter((_, index) => index !== located.index),
      },
    } : undefined,
    deleteId: row ? id : undefined,
  };
}
