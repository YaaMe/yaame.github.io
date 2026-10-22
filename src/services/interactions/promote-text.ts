import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import type { ArchivedComment } from "../../selectors/interactions/comment-archive.ts";

type Node = DefaultTreeAdapterTypes.Node;
type Run = NonNullable<ArchivedComment["content"]>[number][number];

function attributes(node: Node) {
  return Object.fromEntries(("attrs" in node ? node.attrs : undefined)?.map(({ name, value }) => [name, value]) ?? []);
}

function textOf(node: Node, visibleOnly = false): string {
  if ("value" in node) return node.value.replace(/[\t\n\f\r ]+/g, " ");
  if (("tagName" in node ? node.tagName : undefined) === "br") return "\n";
  const classes = new Set(
    (attributes(node).class ?? "").toLowerCase().split(/\s+/).filter(Boolean),
  );
  if (visibleOnly && classes.has("invisible")) return "";
  return ("childNodes" in node ? node.childNodes : []).map((child) => textOf(child, visibleOnly)).join("");
}

function anchor(node: Node): Run {
  const attrs = attributes(node);
  const label = textOf(node, true).trim();
  const href = attrs.href?.trim();
  if (!href || !URL.canParse(href) || !["http:", "https:"].includes(new URL(href).protocol)) {
    return { type: "text", text: label };
  }
  const classes = new Set((attrs.class ?? "").split(/\s+/));
  if (classes.has("hashtag")) {
    return { type: "hashtag", href, name: label.trim().replace(/^#/, "") };
  }
  if (classes.has("mention")) {
    return { type: "mention", href, handle: label.trim() };
  }
  return { type: "link", href, label: label || href };
}

/**
 * A format conversion, not a sanitiser: the archive contains data, and the
 * template must escape every string and render the run types itself.
 */
export function toContent(html: string) {
  const paragraphs: Run[][] = [];
  let runs: Run[] = [];

  function append(run: Run) {
    if (run.type === "text") {
      if (!run.text) return;
      const last = runs.at(-1);
      if (last?.type === "text") {
        last.text += run.text;
        return;
      }
    }
    runs.push(run);
  }

  function finishParagraph() {
    if (runs[0]?.type === "text") runs[0].text = runs[0].text.trimStart();
    const last = runs.at(-1);
    if (last?.type === "text") last.text = last.text.trimEnd();
    const paragraph = runs.filter((run) => run.type !== "text" || run.text);
    if (paragraph.length) paragraphs.push(paragraph);
    runs = [];
  }

  function visit(node: Node) {
    const tagName = "tagName" in node ? node.tagName : undefined;
    if ("value" in node || tagName === "br") {
      append({ type: "text", text: textOf(node) });
    } else if (tagName === "a") {
      // Mastodon's invisible spans hide URL pieces in the browser; the href
      // keeps the complete target while the run label keeps the visible form.
      append(anchor(node));
    } else {
      if (tagName === "p") finishParagraph();
      for (const child of "childNodes" in node ? node.childNodes : []) visit(child);
      if (tagName === "p") finishParagraph();
    }
  }

  visit(parseFragment(html));
  finishParagraph();
  return paragraphs;
}
