import { getCollection, type CollectionEntry } from "astro:content";
import { visibleComments } from "./comment-view";
import { SOURCES } from "../../models/interactions/key-scheme";

export type Comment = CollectionEntry<"comments">["data"]["comments"][number];

/**
 * The promoted comments under one post or note, oldest first. `withdrawn` is
 * supplied by the full profile's live database view; the static profile leaves
 * it empty and uses the withdrawal state recorded in git.
 */
export async function commentsFor(
  contentId: string,
  withdrawn: ReadonlyMap<string, string> = new Map(),
): Promise<Comment[]> {
  const files = await getCollection("comments");
  const under = files
    .flatMap((f) => f.data.comments)
    .filter((c) => c.root === contentId)
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
export function handle(author: Pick<Comment["author"], "source" | "identifier">): string {
  if (author.source !== SOURCES.activitypub) return "";
  try {
    const url = new URL(author.identifier);
    const name = url.pathname.split("/").filter(Boolean).at(-1);
    return name ? `@${name}@${url.host}` : url.host;
  } catch {
    return author.identifier;
  }
}
