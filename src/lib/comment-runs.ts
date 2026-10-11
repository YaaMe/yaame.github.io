import type { z } from "zod";
import type { commentRun } from "./comment-schema";

export type CommentRun = z.infer<typeof commentRun>;

export function runLabel(run: CommentRun): string {
  return run.type === "text"
    ? run.text
    : run.type === "link"
      ? run.label
      : run.type === "mention"
        ? run.handle
        : `#${run.name}`;
}

/** The text a reader gets from the escaped runs, with paragraph breaks. */
export function renderedText(content: readonly (readonly CommentRun[])[]): string {
  return content.map((paragraph) => paragraph.map(runLabel).join("")).join("\n\n");
}
