import { platform } from "../../platform";
import { AUTH, roleOf, type Role } from "./config";

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

const KEY = (id: string) => `auth:session:${id}`;
const COOKIE = "session";
const STATE = "oauth_state";

/**
 * Opaque, and from the platform's own generator.
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

/** One cookie value out of a header, without pulling in a parser. */
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

export const setSessionCookie = (id: string) =>
  `${COOKIE}=${id}; ${attrs(AUTH.sessionDays * 86400)}`;
export const clearSessionCookie = () => `${COOKIE}=; ${attrs(0)}`;
export const setStateCookie = (value: string) =>
  `${STATE}=${value}; ${attrs(600, "/auth")}`;
export const clearStateCookie = () => `${STATE}=; ${attrs(0, "/auth")}`;
export const readStateCookie = (req: Request) =>
  cookie(req.headers.get("cookie"), STATE);

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
  await platform.put(KEY(id), session, { ttl: AUTH.sessionDays * 86400 });
  return id;
}

/**
 * The session a request carries, if it still holds.
 *
 * Expiry is checked here rather than trusted to the store: a host that cannot
 * expire a key would otherwise keep answering with a session that should have
 * ended.
 */
export async function current(req: Request): Promise<(Session & { role: Role }) | null> {
  const id = cookie(req.headers.get("cookie"), COOKIE);
  if (!id) return null;
  const session = await platform.get<Session>(KEY(id));
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await platform.remove(KEY(id));
    return null;
  }
  return { ...session, role: roleOf(session.userId) };
}

/** Revocation, which is the reason the record exists rather than a signature. */
export async function destroy(req: Request): Promise<void> {
  const id = cookie(req.headers.get("cookie"), COOKIE);
  if (id) await platform.remove(KEY(id));
}
