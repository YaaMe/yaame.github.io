import { platform } from "../../platform";
import { AUTH, type Role } from "./config";
import {
  currentSession,
  readSessionCookie,
  sessionKey,
  type Session,
} from "./session-core";

export type { Session } from "./session-core";
export {
  clearSessionCookie,
  clearStateCookie,
  clearVerifierCookie,
  readStateCookie,
  readVerifierCookie,
  refererPath,
  safeReturn,
  setSessionCookie,
  setStateCookie,
  setVerifierCookie,
} from "./session-core";

/**
 * Opaque, and from the runtime's cryptographic random generator.
 *
 * Nothing about a session id is derived from the user, so a leaked one reveals
 * nothing and a guessed one is the only way in — which is what the length is
 * for.
 */
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function create(user: { id: number; login: string }): Promise<string> {
  const id = token();
  const now = new Date();
  const expires = new Date(now.getTime() + AUTH.sessionDays * 86400_000);
  const session: Session = {
    userId: user.id,
    login: user.login,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
  await platform.put(sessionKey(id), session, { ttl: AUTH.sessionDays * 86400 });
  return id;
}

export async function current(req: Request): Promise<(Session & { role: Role }) | null> {
  return currentSession(req, {
    get: (key) => platform.get<Session>(key),
    remove: (key) => platform.remove(key),
  });
}

/** Revocation, which is the reason the record exists rather than a signature. */
export async function destroy(req: Request): Promise<void> {
  const id = readSessionCookie(req);
  if (id) await platform.remove(sessionKey(id));
}
