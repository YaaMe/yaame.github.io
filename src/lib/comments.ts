import { getCollection, type CollectionEntry } from "astro:content";
import { AP } from "../integrations/activitypub/config";

export type Comment = CollectionEntry<"comments">["data"]["comments"][number];

// Posts and notes share one ActivityPub namespace, so one lookup serves both.
// This must match the path ActivityPub objects are served at. If that path
// changes, no stored `rootId` matches and every page shows no comments, with
// nothing reporting it.
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
  const under = files
    .flatMap((f) => f.data.comments)
    .filter((c) => c.rootId === rootId)
    .sort((a, b) => a.published.localeCompare(b.published));

  // A withdrawn comment (no `content`) is shown only when another comment
  // replies to it; otherwise that reply would answer nothing. One that nothing
  // replies to is hidden, because even a line saying someone spoke here is a
  // record of them.
  //
  // Such entries are also removed from git, later and separately. This filter
  // does not wait for that.
  const answered = new Set(under.map((c) => c.replyToId).filter(Boolean));
  return under.filter((c) => c.content !== undefined || answered.has(c.objectId));
}

/**
 * `@name@host`, derived from the actor's address.
 *
 * The address does not change when the author renames themselves. A stored
 * `name` is a copy taken at promotion and can go stale, so the handle is shown
 * beside it, or alone when there is no name.
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

const LINK = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)）。，；：！？]/g;

/**
 * One paragraph, split into what is a link and what is not.
 *
 * The text is rendered as text — escaped by the template, never handed to
 * `set:html` — so this only has to decide where an anchor starts and ends. A
 * mis-parse here shows a wrong link, not an injection. See docs/decisions/0006.
 */
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
