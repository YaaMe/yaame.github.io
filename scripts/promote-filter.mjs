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
import { byFollowing, byAuthor, wholeThread, nothing } from "../src/services/interactions/promote-filter.ts";
export { byFollowing, byAuthor, wholeThread, nothing };

/** The rule in force. Edit this file when the owner's policy changes. */
export default byFollowing();
