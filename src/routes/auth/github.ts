import type { APIRoute } from "astro";
import { refererPath } from "../../params/auth.ts";
import { setStateCookie, setVerifierCookie } from "../../schemas/auth-cookies.ts";
import { githubCallbackUrl } from "../../schemas/auth-urls.ts";
import { beginLogin } from "../../services/auth/oauth.ts";
import { safeReturn } from "../../services/auth/return.ts";

export const prerender = false;

/**
 * Hand the visitor to GitHub.
 *
 * The `state` is minted here and kept in a cookie the callback compares
 * against. Without it, a link from anywhere could complete a login in someone
 * else's browser: the callback would see a code, exchange it, and set a
 * session the visitor never asked for.
 *
 * The page they left rides along in the state cookie, while state and the
 * verifier both expire after ten minutes and are cleared by the callback.
 * Sign-in can start from any page, so "back" is not a fixed address. It comes
 * from the referer, which a same-origin navigation sends in full; where a
 * browser withholds it, the login ends on the front page rather than failing.
 */
export const GET: APIRoute = async ({ request }) => {
  const flow = await beginLogin(githubCallbackUrl(request.url));
  const from = safeReturn(refererPath(request));
  const headers = new Headers({ location: flow.url });
  headers.append("set-cookie", setStateCookie(flow.state, from));
  headers.append("set-cookie", setVerifierCookie(flow.verifier));
  return new Response(null, {
    status: 302,
    headers,
  });
};
