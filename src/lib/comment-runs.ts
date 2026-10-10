export type CommentRun =
  | { type: "text"; text: string }
  | { type: "link"; href: string; label: string }
  | { type: "mention"; href: string; handle: string }
  | { type: "hashtag"; href: string; name: string };

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
