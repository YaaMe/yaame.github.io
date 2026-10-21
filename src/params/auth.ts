import { SESSION_COOKIE, STATE_COOKIE, VERIFIER_COOKIE, decodeState } from "./auth-cookies.ts";

function cookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

export const readStateCookie = (req: Request) =>
  cookie(req.headers.get("cookie"), STATE_COOKIE);
export const readVerifierCookie = (req: Request) =>
  cookie(req.headers.get("cookie"), VERIFIER_COOKIE);
export const readSessionCookie = (req: Request) =>
  cookie(req.headers.get("cookie"), SESSION_COOKIE);

/** Where a same-origin navigation came from, as a path. */
export function refererPath(req: Request): string {
  const ref = req.headers.get("referer");
  if (!ref) return "/";
  try {
    const from = new URL(ref);
    if (from.origin !== new URL(req.url).origin) return "/";
    return from.pathname + from.search;
  } catch {
    return "/";
  }
}

export function callbackParams(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const { expected, from } = decodeState(readStateCookie(request));
  return { code, state, expected, from, verifier: readVerifierCookie(request) };
}
