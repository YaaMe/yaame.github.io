import { AUTH } from "../config/auth.ts";
import { randomToken } from "../lib/encoding.ts";
import type { Session, ActiveSession } from "../models/records/sessions.ts";
import { sessionRecord } from "../persistence/records/sessions.ts";
import { roleOf } from "./auth/roles.ts";

export type { Role, ActiveSession } from "../models/records/sessions.ts";

/**
 * `expired` carries the credential so cleanup removes that record and nothing
 * else, without reading it again.
 */
export type SessionRead =
  | { state: "absent" }
  | { state: "expired"; id: string }
  | { state: "active"; session: ActiveSession };

/**
 * The session a request carries, and whether it still holds. Only reads.
 *
 * Expiry is checked here rather than trusted to the store: a host that cannot
 * expire a key would otherwise keep answering with a session that should have
 * ended.
 */
export async function readSession(
  id: string | null,
  now = Date.now(),
): Promise<SessionRead> {
  if (!id) return { state: "absent" };
  const session = await sessionRecord(id).get();
  if (!session) return { state: "absent" };
  if (new Date(session.expiresAt).getTime() <= now) return { state: "expired", id };
  return { state: "active", session: { ...session, role: roleOf(session.userId) } };
}

/**
 * Opaque, and from the runtime's cryptographic random generator.
 *
 * Nothing about a session id is derived from the user, so a leaked one reveals
 * nothing and a guessed one is the only way in — which is what the length is
 * for.
 */
export async function create(user: { id: number; login: string }): Promise<string> {
  const id = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + AUTH.sessionDays * 86400_000);
  const session: Session = {
    userId: user.id,
    login: user.login,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
  await sessionRecord(id).put(session);
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
async function discardExpired(id: string): Promise<void> {
  try {
    await sessionRecord(id).remove();
  } catch (error) {
    console.warn("expired session not removed; reads still refuse it", {
      error: error instanceof Error ? error.name : typeof error,
      code: (error as { code?: unknown } | null)?.code,
    });
  }
}

export async function current(id: string | null, now = Date.now()): Promise<ActiveSession | null> {
  const read = await readSession(id, now);
  if (read.state === "expired") await discardExpired(read.id);
  return read.state === "active" ? read.session : null;
}

/** Revocation, which is the reason the record exists rather than a signature. */
export async function destroy(id: string | null): Promise<void> {
  if (id) await sessionRecord(id).remove();
}
