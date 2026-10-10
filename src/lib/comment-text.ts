const LINK = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)）。，；：！？]/g;

/** Split one plain-text paragraph into link and text runs for the template. */
export function segments(paragraph: string): { text?: string; url?: string }[] {
  const out: { text?: string; url?: string }[] = [];
  let last = 0;
  for (const match of paragraph.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ text: paragraph.slice(last, start) });
    out.push({ url: match[0] });
    last = start + match[0].length;
  }
  if (last < paragraph.length) out.push({ text: paragraph.slice(last) });
  return out;
}

/** Blank lines separate paragraphs; single newlines are kept by the CSS. */
export const paragraphs = (text: string) =>
  text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
