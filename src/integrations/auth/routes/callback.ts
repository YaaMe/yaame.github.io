import type { APIRoute } from "astro";
import { platform } from "../../../platform";
import { AUTH } from "../config";
import { clearStateCookie, create, readStateCookie, safeReturn, setSessionCookie } from "../session";

export const prerender = false;

/**
 * Where to go next.
 *
 * A failure goes to /login, which is the only page that can explain one. A
 * success goes back to whatever page the visitor left — carried through the
 * round trip in the state cookie, and refused by `safeReturn` unless it is a
 * path on this site.
 */
const back = (request: Request, to: string) => new URL(to, request.url).href;
const failTo = (request: Request, error: string) => {
  const to = new URL("/login", request.url);
  to.searchParams.set("error", error);
  return to.href;
};

/**
 * Finish the login.
 *
 * The state check comes first and is unconditional. A callback carrying a
 * code but no matching cookie is not a login that lost its cookie — it is a
 * request someone else composed, and treating it as the former is how a
 * session gets planted in a visitor's browser.
 */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // The cookie carries the state and the page to return to, in that order.
  const carried = readStateCookie(request);
  const seam = carried ? carried.indexOf(".") : -1;
  const expected = seam < 0 ? carried : carried!.slice(0, seam);
  let carriedFrom = "/";
  if (seam >= 0) {
    // One decode, undoing the one encode the start route applied. What comes
    // out is still a percent-encoded path, which is what `safeReturn` wants.
    try {
      carriedFrom = decodeURIComponent(carried!.slice(seam + 1));
    } catch {
      carriedFrom = "/";
    }
  }
  const from = safeReturn(carriedFrom);

  const fail = (why: string) =>
    new Response(null, {
      status: 302,
      headers: { location: failTo(request, why), "set-cookie": clearStateCookie() },
    });

  if (!state || !expected || state !== expected) return fail("state");
  if (!code) return fail("code");

  // The client id is a literal in this repository; the secret is placed by
  // hand on the Worker and is the half that can actually be missing.
  const secret = platform.secret("GITHUB_CLIENT_SECRET");
  if (!secret) return fail("config");

  let token: string | undefined;
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: AUTH.clientId,
        client_secret: secret,
        code,
        redirect_uri: new URL("/auth/github/callback", request.url).href,
      }),
    });
    // GitHub answers 200 with `{"error": …}` for a spent or forged code, so
    // the status says nothing on its own.
    const body = (await res.json()) as { access_token?: string };
    token = body.access_token;
  } catch {
    return fail("exchange");
  }
  if (!token) return fail("exchange");

  let user: { id: number; login: string };
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        // GitHub rejects an API request without one.
        "user-agent": "blogu",
      },
    });
    if (!res.ok) return fail("user");
    user = await res.json();
  } catch {
    return fail("user");
  }
  if (typeof user.id !== "number" || !user.login) return fail("user");

  const id = await create({ id: user.id, login: user.login });

  // Two cookies: the session is set and the state is spent. A state left
  // behind is a second chance at a replay it already survived.
  const headers = new Headers({ location: back(request, from) });
  headers.append("set-cookie", setSessionCookie(id));
  headers.append("set-cookie", clearStateCookie());
  return new Response(null, { status: 302, headers });
};
