import { AUTH } from "../../config/auth.ts";
import { roleOf, type Role } from "../../services/auth/roles.ts";
import { sessions } from "../../config/data.config.generated.mjs";

/**
 * Only what is used.
 *
 * GitHub also hands back a real name and an avatar. Neither is shown, and
 * keeping a person's legal name because it arrived is collecting it for no
 * reason. The avatar costs nothing to drop either: its address is derivable
 * from the id.
 */
export type Session = {
  userId: number;
  login: string;
  createdAt: string;
  expiresAt: string;
};

const COOKIE = "session";
const STATE = "oauth_state";
const VERIFIER = "oauth_verifier";
const OAUTH_COOKIE_MAX_AGE = 600;

function cookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/**
 * `SameSite=Lax`, deliberately, not `Strict`.
 *
 * The callback is a top-level navigation arriving from github.com. Under
 * `Strict` the browser withholds the cookie on exactly that request, so the
 * state check would fail every login — the guard would reject the only
 * traffic it exists to admit.
 */
const attrs = (maxAge: number, path = "/") =>
  `Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const sessionKey = (id: string) => sessions.key(id);

export const setSessionCookie = (id: string) =>
  `${COOKIE}=${id}; ${attrs(AUTH.sessionDays * 86400)}`;
export const clearSessionCookie = () => `${COOKIE}=; ${attrs(0)}`;
export const setStateCookie = (value: string) =>
  `${STATE}=${value}; ${attrs(OAUTH_COOKIE_MAX_AGE, "/auth")}`;
export const clearStateCookie = () => `${STATE}=; ${attrs(0, "/auth")}`;
export const setVerifierCookie = (value: string) =>
  `${VERIFIER}=${value}; ${attrs(OAUTH_COOKIE_MAX_AGE, "/auth")}`;
export const clearVerifierCookie = () => `${VERIFIER}=; ${attrs(0, "/auth")}`;
export const readStateCookie = (req: Request) =>
  cookie(req.headers.get("cookie"), STATE);
export const readVerifierCookie = (req: Request) =>
  cookie(req.headers.get("cookie"), VERIFIER);
export const readSessionCookie = (req: Request) =>
  cookie(req.headers.get("cookie"), COOKIE);

/**
 * A path on this site, or "/".
 *
 * Whatever comes back from the round trip ends up in a `Location` header, so
 * this is the difference between returning someone to their page and handing
 * an open redirect to anyone who can compose a link. Refused: anything not
 * starting with "/", anything starting with "//" or "/\\" (URL parsers read
 * the rest as a host, which is the redirect off-site), control characters
 * (header injection), and /auth itself, which would restart the login it
 * just finished.
 */
export function safeReturn(path: string | null | undefined): string {
  if (!path) return "/";

  // Checked twice: as written, and as a browser reads it after one decode.
  // An encoded "//" is the same off-site redirect spelled differently, and
  // checking only one of the two forms lets the other through.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "/";
  }
  for (const form of [path, decoded]) {
    if (!form.startsWith("/")) return "/";
    if (form.startsWith("//") || form.startsWith("/\\")) return "/";
    if (/[\u0000-\u001f\u007f]/.test(form)) return "/";
    if (form === "/auth" || form.startsWith("/auth/")) return "/";
  }

  // As written. Returning the decoded form would rename the target: %2F is a
  // character in a segment, and "/" is a segment boundary.
  return path;
}

/** Where a same-origin navigation came from, as a path. */
export function refererPath(req: Request): string {
  const ref = req.headers.get("referer");
  if (!ref) return "/";
  try {
    const from = new URL(ref);
    if (from.origin !== new URL(req.url).origin) return "/";
    return safeReturn(from.pathname + from.search);
  } catch {
    return "/";
  }
}

export type SessionReader = {
  get(key: string): Promise<Session | null>;
};

/**
 * What the record a request names says about it. `expired` carries the key
 * so the caller can remove that record and nothing else.
 */
export type SessionRead =
  | { state: "absent" }
  | { state: "expired"; key: string }
  | { state: "active"; session: Session & { role: Role } };

/**
 * The session a request carries, and whether it still holds. Only reads.
 *
 * Expiry is checked here rather than trusted to the store: a host that cannot
 * expire a key would otherwise keep answering with a session that should have
 * ended.
 */
export async function readSession(
  req: Request,
  store: SessionReader,
  now = Date.now(),
): Promise<SessionRead> {
  const id = readSessionCookie(req);
  if (!id) return { state: "absent" };
  const key = sessionKey(id);
  const session = await store.get(key);
  if (!session) return { state: "absent" };
  if (new Date(session.expiresAt).getTime() <= now) return { state: "expired", key };
  return { state: "active", session: { ...session, role: roleOf(session.userId) } };
}
