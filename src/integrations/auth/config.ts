/**
 * Who may log in, and what that is worth.
 *
 * Anyone with a GitHub account may log in. The list below decides what they
 * may then do, and for almost everyone the answer is nothing — the session
 * only says which stranger this is.
 *
 * See docs/decisions/0010-a-session-is-not-a-privilege.md.
 */
export const AUTH = {
  /**
   * The OAuth App's client id.
   *
   * Public: it travels in every authorize URL, and a reader of this file
   * learns nothing they could not read off the address bar. The half that
   * matters is `GITHUB_CLIENT_SECRET`, which is a Worker secret and is in no
   * file here.
   */
  clientId: "Ov23liS07tFJ9uUm7g3n",

  /**
   * Identified by number, never by login.
   *
   * A GitHub username can be changed, and the abandoned one becomes available
   * to anyone. A list written in usernames hands the owner's privileges to
   * whoever registers the old name next. The login is here as a label for
   * people reading this file; nothing compares against it.
   */
  owner: { id: 8050204, login: "YaaMe" },

  /**
   * Everyone else who is more than a stranger. Same rule: the id decides.
   *
   * TODO: entries carry identity and nothing else, because no privilege exists
   * yet to grant. A `can: [...]` invented now would be a guess at names and
   * granularity, and the cost of guessing wrong is not the code — it is the
   * data: once real people are written down, changing the shape means
   * rewriting their entries. Decide it when the first privilege is real.
   *
   * Nothing has to be migrated when that day comes. `roleOf` is asked on every
   * read rather than stored in the session, so a change here reaches sessions
   * already issued, and nobody has to log in again.
   */
  allow: [] as { id: number; login: string }[],

  sessionDays: 30,

  /**
   * Only `read:user`, and never absent.
   *
   * GitHub treats an empty scope as "whatever this user has granted before",
   * so what arrives would depend on their history rather than on what we
   * asked for.
   */
  scope: "read:user",
} as const;

export type Role = "owner" | "allowed" | "guest";

/**
 * What a logged-in user is allowed to be.
 *
 * Every privileged path asks this. None of them may ask whether a session
 * exists: that question is answered `true` for any stranger who has clicked
 * the button, which is the whole failure this separation exists to prevent.
 */
export function roleOf(userId: number): Role {
  if (userId === AUTH.owner.id) return "owner";
  return AUTH.allow.some((a) => a.id === userId) ? "allowed" : "guest";
}
