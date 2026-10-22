import { commentHref } from "../../models/content/comments.ts";
import { handle, type Comment } from "./promoted";
import { runLabel } from "./comment-runs";

export const stamp = (iso: string) => iso.slice(0, 10);
export const safeHref = (value: string) => {
  const parsed = commentHref.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

export function commentDisplay(comment: Comment) {
  return {
    author: {
      href: safeHref(comment.author.identifier),
      label: comment.author.name ?? handle(comment.author),
      handle: comment.author.name ? handle(comment.author) : undefined,
    },
    href: safeHref(comment.objectId),
    published: comment.published,
    date: stamp(comment.published),
    deletedDate: comment.deletedAt && stamp(comment.deletedAt),
    content: comment.content?.map((paragraph) => paragraph.map((run) =>
      run.type === "text"
        ? { type: "text" as const, text: run.text }
        : { type: "link" as const, href: safeHref(run.href), label: runLabel(run) },
    )),
  };
}
