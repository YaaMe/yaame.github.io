import { platform } from "../platform";
import { AUTH } from "../config/auth";
import type { Role } from "./auth/roles";
import {
  readSession,
  readSessionCookie,
  sessionKey,
  type Session,
} from "../integrations/auth/session-core";

export type { Role } from "./auth/roles";

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

/**
 * A host that cannot expire a key keeps the record until something removes it.
 *
 * Removes by key without reading the record again, which is safe only while
 * nothing rewrites an existing session key: a write landing between the read
 * and this removal would be deleted with it. Renewal, if ever added, belongs in
 * this service so that it and this removal are ordered in one place.
 *
 * A failure leaves an expired record that every read still refuses, so it is
 * logged and the read goes on. The log names the error's kind only: a host's
 * message can quote the key, and the key carries the session id.
 */
async function discardExpired(key: string): Promise<void> {
  try {
    await platform.remove(key);
  } catch (error) {
    console.warn("expired session not removed; reads still refuse it", {
      error: error instanceof Error ? error.name : typeof error,
      code: (error as { code?: unknown } | null)?.code,
    });
  }
}

export async function current(req: Request): Promise<(Session & { role: Role }) | null> {
  const read = await readSession(req, { get: (key) => platform.get<Session>(key) });
  if (read.state === "expired") await discardExpired(read.key);
  return read.state === "active" ? read.session : null;
}

/** Revocation, which is the reason the record exists rather than a signature. */
export async function destroy(req: Request): Promise<void> {
  const id = readSessionCookie(req);
  if (id) await platform.remove(sessionKey(id));
}
