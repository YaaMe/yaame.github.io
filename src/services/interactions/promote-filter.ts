import type { PromotionCandidate } from "./promote.ts";
import { followIntent } from "../../config/data.config.generated.mjs";
import { SOURCES } from "../../models/interactions/key-scheme.ts";

function handleFor(actorId: string) {
  try {
    const actor = new URL(actorId);
    const name = actor.pathname.split("/").filter(Boolean).at(-1);
    return name ? `${name.replace(/^@/, "")}@${actor.host}` : null;
  } catch {
    return null;
  }
}

function normaliseFollowed(value: unknown) {
  const entries = Array.isArray(value) ? value : (value as { follow?: unknown } | null | undefined)?.follow;
  if (!Array.isArray(entries)) return new Set();
  return new Set(entries.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const value = entry.trim().replace(/^@/, "");
    if (!value) return [];
    const aliases = [value];
    const handle = handleFor(value);
    if (handle) aliases.push(handle);
    return aliases;
  }));
}

/** Keep replies written by actors in the owner's following intent. */
export const byFollowing = (following: unknown = followIntent) => {
  const followed = normaliseFollowed(following);
  return <T extends PromotionCandidate>(thread: T[]) => thread.filter((comment) => {
    if (comment.author.source !== SOURCES.activitypub) return false;
    const actorId = comment.author.identifier;
    return followed.has(actorId) || (handleFor(actorId) !== null && followed.has(handleFor(actorId)!));
  });
};

/** Keep everything these actors wrote. */
export const byAuthor = (actors: string[]) => <T extends PromotionCandidate>(thread: T[]) =>
  thread.filter((comment) => comment.author.source === SOURCES.activitypub && actors.includes(comment.author.identifier));

/** Keep the whole thread when any one comment matches. */
export const wholeThread = <T>(match: (comment: T) => boolean) => (thread: T[]) =>
  thread.some(match) ? thread : [];

/** Keep nothing. */
export const nothing = () => [];

