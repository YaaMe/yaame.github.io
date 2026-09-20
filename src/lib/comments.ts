import { getCollection, type CollectionEntry } from "astro:content";
import { AP } from "../integrations/activitypub/config";

export type Comment = CollectionEntry<"comments">["data"]["comments"][number];

// Posts and notes share one ActivityPub namespace, so one lookup serves both.
// Built here rather than stored on each comment: the address is already in
// `rootId`, and a copy of the route pattern would agree today and diverge the
// moment it changes, with nothing reporting it.
const ROOT = `https://${AP.actorHost}/users/${AP.user}/notes/`;

/**
 * The promoted comments under one post or note, oldest first.
 *
 * Only what is in git. The database holds everything that arrived; this holds
 * what was chosen, and the two profiles must show the same thing — the static
 * site has no database to ask.
 */
export async function commentsFor(slug: string): Promise<Comment[]> {
  const rootId = ROOT + slug;
  const files = await getCollection("comments");
  return files
    .flatMap((f) => f.data.comments)
    .filter((c) => c.rootId === rootId)
    .sort((a, b) => a.published.localeCompare(b.published));
}

/**
 * `@name@host`, derived from the actor's address.
 *
 * The stored record has no display name on purpose: it is theirs to change,
 * and a copy taken at promotion would be wrong the day after. The address is
 * the part that does not move.
 */
export function handle(actorId: string): string {
  try {
    const u = new URL(actorId);
    const name = u.pathname.split("/").filter(Boolean).at(-1);
    return name ? `@${name}@${u.host}` : u.host;
  } catch {
    return actorId;
  }
}

/**
 * One paragraph, split into what is a link and what is not.
 *
 * The text is rendered as text — escaped by the template, never handed to
 * `set:html` — so this only has to decide where an anchor starts and ends. A
 * mis-parse here shows a wrong link, not an injection, which is the whole
 * reason the content is stored as text. See docs/decisions/0006.
 */
const LINK = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)）。，；：！？]/g;

export function segments(paragraph: string): { text?: string; url?: string }[] {
  const out: { text?: string; url?: string }[] = [];
  let last = 0;
  for (const m of paragraph.matchAll(LINK)) {
    if (m.index > last) out.push({ text: paragraph.slice(last, m.index) });
    out.push({ url: m[0] });
    last = m.index + m[0].length;
  }
  if (last < paragraph.length) out.push({ text: paragraph.slice(last) });
  return out;
}

/** Blank lines separate paragraphs; single newlines are kept by the CSS. */
export const paragraphs = (text: string) =>
  text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
