import { AUTH } from "../../config/auth.ts";
import type { Role } from "../../models/records/sessions.ts";

export type { Role, ActiveSession } from "../../models/records/sessions.ts";

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
