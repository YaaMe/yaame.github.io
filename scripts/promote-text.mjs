import { parseFragment } from "parse5";

function attributes(node) {
  return Object.fromEntries(node.attrs?.map(({ name, value }) => [name, value]) ?? []);
}

function textOf(node, visibleOnly = false) {
  if (node.nodeName === "#text") return node.value.replace(/[\t\n\f\r ]+/g, " ");
  if (node.tagName === "br") return "\n";
  const classes = new Set(
    (attributes(node).class ?? "").toLowerCase().split(/\s+/).filter(Boolean),
  );
  if (visibleOnly && classes.has("invisible")) return "";
  return (node.childNodes ?? []).map((child) => textOf(child, visibleOnly)).join("");
}

function anchor(node) {
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
export function toContent(html) {
  const paragraphs = [];
  let runs = [];

  function append(run) {
    if (run.type === "text") {
      if (!run.text) return;
      if (runs.at(-1)?.type === "text") {
        runs.at(-1).text += run.text;
        return;
      }
    }
    runs.push(run);
  }

  function finishParagraph() {
    if (runs[0]?.type === "text") runs[0].text = runs[0].text.trimStart();
    if (runs.at(-1)?.type === "text") runs.at(-1).text = runs.at(-1).text.trimEnd();
    const paragraph = runs.filter((run) => run.type !== "text" || run.text);
    if (paragraph.length) paragraphs.push(paragraph);
    runs = [];
  }

  function visit(node) {
    if (node.nodeName === "#text" || node.tagName === "br") {
      append({ type: "text", text: textOf(node) });
    } else if (node.tagName === "a") {
      // Mastodon's invisible spans hide URL pieces in the browser; the href
      // keeps the complete target while the run label keeps the visible form.
      append(anchor(node));
    } else {
      if (node.tagName === "p") finishParagraph();
      for (const child of node.childNodes ?? []) visit(child);
      if (node.tagName === "p") finishParagraph();
    }
  }

  visit(parseFragment(html));
  finishParagraph();
  return paragraphs;
}
