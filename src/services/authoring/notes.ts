import { OBJECT_PATH_TEMPLATE, objectUrl } from "../../models/activitypub/object-id.ts";
import { isPublished } from "../../gateways/activitypub/publication-probe.ts";
import { fillPath } from "../../lib/path-template.ts";

export type AuthoredNote = { id: string; published: string; content: string };
type NoteArchive = { notes: AuthoredNote[]; [key: string]: unknown };

/**
 * The id is not the time.
 *
 * Several notes in one day are ordinary, so a timestamp cannot be an identity.
 * A non-date-shaped string also keeps this namespace clear of the long posts,
 * whose slugs are date-shaped (`2025-year`, `2023-07`) and share
 * `/users/…/notes/`.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l/o/0/1: read aloud without error

/** Every id in every year. A published id is that note's identity for good. */
export function takenNoteIds(documents: NoteArchive[]) {
  return new Set(documents.flatMap((document) => document.notes.map((note) => note.id)));
}

// Two generators would define the same id space twice. A collision would
// publish two notes at one address.
export function newNoteId(taken: Set<string>, random: () => number) {
  const make = () =>
    Array.from({ length: 8 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
  let id = make();
  while (taken.has(id)) id = make();
  return id;
}

export function prepareNote(body: string, when: Date, createId: () => string) {
  // Normalised to UTC, because the site orders notes by comparing these strings,
  // and a mix of `Z` and `+08:00` does not compare: 09:00+08:00 sorts after
  // 02:00Z while being an hour earlier. The outbox is an OrderedCollection, so a
  // wrong order breaks the specification, not just the page.
  const published = when.toISOString().replace(/\.\d{3}Z$/, "Z");
  // UTC, deliberately not the site's timezone: this number becomes the note's
  // permanent address, and it must not depend on a setting that can be edited.
  const year = when.getUTCFullYear();
  return { year, note: { id: createId(), published, content: body } };
}

export function appendNote(source: string | undefined, note: AuthoredNote) {
  const doc: NoteArchive = source === undefined ? { notes: [] } : JSON.parse(source);
  doc.notes.push(note);
  doc.notes.sort((a, b) => a.published.localeCompare(b.published));
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function noteSource(source: string, asPost: string, sourceExists: boolean) {
  const file = sourceExists ? source : asPost;
  // Explicit paths keep their existing bypass until B4. A slug alone identifies
  // a post whose published ActivityPub id and promoted comments need checking.
  return { file, slug: file === asPost ? source : null };
}

export function parseNoteDraft(raw: string, now: () => Date) {
  let head = "";
  let body = raw.trim();
  if (raw.startsWith("---\n")) {
    const end = raw.indexOf("\n---", 4);
    if (end < 0) return { status: "open-frontmatter" as const };
    head = raw.slice(4, end);
    body = raw.slice(end + 4).trim();
  }
  if (!body) return { status: "empty" as const };

  const value = (n: string) => head.match(new RegExp(`^${n}\\s*:\\s*(.+)$`, "m"))?.[1]?.trim();
  const tags = (() => {
    const inline = value("tags");
    if (inline?.startsWith("[")) return inline.slice(1, -1).split(",").map((t) => t.trim());
    const block = head.match(/^tags\s*:\s*\n((?:\s*-\s*.+\n?)+)/m);
    return block ? block[1].trim().split("\n").map((l) => l.replace(/^\s*-\s*/, "")) : [];
  })();
  const written = value("date")?.replace(/^["']|["']$/g, "");
  const when = written ? new Date(written) : now();
  if (Number.isNaN(when.getTime())) return { status: "invalid-date" as const, written };
  return {
    status: "ready" as const, body, when, dated: Boolean(written),
    title: value("title"), tags, pinned: Boolean(value("pinned")),
  };
}

/**
 * A published post's id is in followers' databases. Conversion gives it a new
 * random id, leaving the old address unanswered and delivering the content again.
 * The protocol requires a Delete, whose signing key is deliberately absent here.
 */
export async function checkNoteConversion(slug: string, force: boolean, input: {
  hasComments: () => boolean;
  configuration: () => string;
  request: typeof fetch;
}) {
  // Promoted comments hang off the post's ActivityPub id. Converting would
  // leave them describing a conversation under an object that no longer
  // answers, and nothing would report it.
  if (input.hasComments()) return { status: "comments" as const };
  const config = input.configuration();
  const field = (n: string) => config.match(new RegExp(`${n}:\\s*"([^"]+)"`))?.[1];
  const host = field("actorHost");
  const user = field("user");
  if (!host || !user) return { status: "configuration" as const };

  let address: URL | undefined;
  let live: boolean;
  try {
    address = objectUrl(host, user, slug);
    live = await isPublished(address, input.request);
  } catch {
    // Unreachable is not "not published", and treating it as one is the
    // single thing that must not happen here.
    return {
      status: "unreachable" as const,
      address: address?.href ?? `https://${host}${fillPath(OBJECT_PATH_TEMPLATE, { identifier: user, slug })}`,
    };
  }
  if (live && !force) return { status: "published" as const, address: address.href };
  return { status: "ready" as const, live };
}
