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

/** Keep everything these actors wrote. */
export const byAuthor = (actors) => (thread) =>
  thread.filter((c) => actors.includes(c.actorId));

/** Keep the whole thread when any one comment matches. */
export const wholeThread = (match) => (thread) =>
  thread.some(match) ? thread : [];

/** Keep nothing. */
export const nothing = () => [];

/**
 * The rule in force.
 *
 * `nothing` by default, not because it is useful but because a default must not
 * make this decision for you. Replace it:
 *
 *   export default byAuthor(["https://mstdn.jp/users/someone"]);
 *   export default wholeThread((c) => c.actorId.startsWith("https://mstdn.jp/"));
 *   export default (thread) => (thread.length <= 3 ? thread : []);
 */
export default nothing;
