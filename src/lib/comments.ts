import { getCollection, type CollectionEntry } from "astro:content";
import { AP } from "../integrations/activitypub/config";
import { visibleComments } from "./comment-view";

export type Comment = CollectionEntry<"comments">["data"]["comments"][number];

// Posts and notes share one ActivityPub namespace, so one lookup serves both.
// This must match the path ActivityPub objects are served at. If that path
// changes, no stored `rootId` matches and every page shows no comments, with
// nothing reporting it.
const ROOT = `https://${AP.actorHost}/users/${AP.user}/notes/`;

export const rootIdFor = (slug: string) => ROOT + slug;

/**
 * The promoted comments under one post or note, oldest first. `withdrawn` is
 * supplied by the full profile's live database view; the static profile leaves
 * it empty and uses the withdrawal state recorded in git.
 */
export async function commentsFor(
  slug: string,
  withdrawn: ReadonlyMap<string, string> = new Map(),
): Promise<Comment[]> {
  const rootId = rootIdFor(slug);
  const files = await getCollection("comments");
  const under = files
    .flatMap((f) => f.data.comments)
    .filter((c) => c.rootId === rootId)
    .sort((a, b) => a.published.localeCompare(b.published));

  return visibleComments(under, withdrawn);
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
