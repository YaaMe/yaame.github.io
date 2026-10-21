import { z } from "zod";
import { AP } from "../../config/activitypub.ts";
import { normalizedUrl } from "../interactions/key-scheme.ts";

export const contentIdentifier = z.string().min(1).regex(/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u);

// The path of the Note object dispatcher's route. Changing that route without
// this prefix stops every reply and reaction from finding its content.
const CONTENT_PREFIX = `https://${AP.actorHost}/users/${AP.user}/notes/`;

/**
 * The site's content identifier a federated object URL names, or null when it names none.
 *
 * A content lookup would fail in the queue consumer, whose framework binding
 * refuses collection reads.
 */
export function contentIdentifierOf(url: string): string | null {
  let identifier: string;
  try {
    const href = normalizedUrl(url);
    if (!href.startsWith(CONTENT_PREFIX)) return null;
    identifier = decodeURIComponent(href.slice(CONTENT_PREFIX.length));
  } catch {
    return null;
  }
  return contentIdentifier.safeParse(identifier).success ? identifier : null;
}
