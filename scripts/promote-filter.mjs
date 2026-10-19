/**
 * Which comments reach git.
 *
 * **This file is yours to edit.** Putting a stranger's words into a public
 * repository is irreversible — git is permanent, indexed and world-readable,
 * and they did not know it would land there when they wrote it.
 *
 * A filter receives a whole thread, not one comment: "keep the entire reply
 * chain" cannot be expressed from a single row. It returns what to keep.
 */
import { followIntent } from "../src/data.config.generated.mjs";
import { SOURCES } from "../src/lib/interactions/key-scheme.ts";

function handleFor(actorId) {
  try {
    const actor = new URL(actorId);
    const name = actor.pathname.split("/").filter(Boolean).at(-1);
    return name ? `${name.replace(/^@/, "")}@${actor.host}` : null;
  } catch {
    return null;
  }
}

function normaliseFollowed(value) {
  const entries = Array.isArray(value) ? value : value?.follow;
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
export const byFollowing = (following = followIntent) => {
  const followed = normaliseFollowed(following);
  return (thread) => thread.filter((comment) => {
    if (comment.author.source !== SOURCES.activitypub) return false;
    const actorId = comment.author.identifier;
    return followed.has(actorId) || (handleFor(actorId) !== null && followed.has(handleFor(actorId)));
  });
};

/** Keep everything these actors wrote. */
export const byAuthor = (actors) => (thread) =>
  thread.filter((comment) => comment.author.source === SOURCES.activitypub && actors.includes(comment.author.identifier));

/** Keep the whole thread when any one comment matches. */
export const wholeThread = (match) => (thread) =>
  thread.some(match) ? thread : [];

/** Keep nothing. */
export const nothing = () => [];

/** The rule in force. Edit this file when the owner's policy changes. */
export default byFollowing();
