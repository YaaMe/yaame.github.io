/**
 * Convert ActivityPub markup into the plain text stored in git.
 *
 * The output is escaped by the page template, so this is a format conversion,
 * not a sanitiser. It keeps a link's label and target together in text. The
 * regular-expression parsing is safe only because the result is escaped text;
 * never reuse it as a sanitiser.
 */
export function toText(html) {
  const entities = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    "&apos;": "'", "&nbsp;": " ",
  };
  return html
    .replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, inner) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      // Not twice when the anchor text is the address: Mastodon routinely
      // truncates a long link for display.
      return !label || url.startsWith(label) || label.startsWith(url) ? url : `${label}（${url}）`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (entity) => entities[entity.toLowerCase()] ?? entity)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
