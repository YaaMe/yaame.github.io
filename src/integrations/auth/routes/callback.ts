import type { APIRoute } from "astro";
import { platform } from "../../../platform";
import { AUTH } from "../config";
import { clearStateCookie, create, readStateCookie, setSessionCookie } from "../session";

export const prerender = false;

/** Back to the page that sent them, with something to read. */
const back = (request: Request, error?: string) => {
  const to = new URL("/login", request.url);
  if (error) to.searchParams.set("error", error);
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
  const expected = readStateCookie(request);

  const fail = (why: string) =>
    new Response(null, {
      status: 302,
      headers: { location: back(request, why), "set-cookie": clearStateCookie() },
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

  let user: { id: number; login: string; name?: string; avatar_url?: string };
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

  const id = await create({
    id: user.id,
    login: user.login,
    ...(user.name ? { name: user.name } : {}),
    ...(user.avatar_url ? { avatar: user.avatar_url } : {}),
  });

  // Two cookies: the session is set and the state is spent. A state left
  // behind is a second chance at a replay it already survived.
  const headers = new Headers({ location: back(request) });
  headers.append("set-cookie", setSessionCookie(id));
  headers.append("set-cookie", clearStateCookie());
  return new Response(null, { status: 302, headers });
};
