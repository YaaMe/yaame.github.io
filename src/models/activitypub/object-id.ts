import { z } from "zod";
import { fillPath, matchUrl } from "../../lib/path-template.ts";

export const contentIdentifier = z.string().min(1).regex(/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u);

export const OBJECT_PATH_TEMPLATE = "/users/{identifier}/notes/{slug}";

export function objectUrl(host: string, user: string, slug: string): URL {
  return new URL(fillPath(OBJECT_PATH_TEMPLATE, { identifier: user, slug }), `https://${host}`);
}

/**
 * The site's content identifier a federated object URL names, or null when it names none.
 *
 * A content lookup would fail in the queue consumer, whose framework binding
 * refuses collection reads.
 */
export function contentIdentifierOf(url: string, host: string, user: string): string | null {
  const identifier = matchUrl(`https://${host}${OBJECT_PATH_TEMPLATE}`, url, { identifier: user })?.slug;
  return identifier !== undefined && contentIdentifier.safeParse(identifier).success ? identifier : null;
}
