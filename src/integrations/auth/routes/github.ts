import type { APIRoute } from "astro";
import { AUTH } from "../config";
import { refererPath, setStateCookie } from "../session";

export const prerender = false;

/**
 * Hand the visitor to GitHub.
 *
 * The `state` is minted here and kept in a cookie the callback compares
 * against. Without it, a link from anywhere could complete a login in someone
 * else's browser: the callback would see a code, exchange it, and set a
 * session the visitor never asked for.
 *
 * The page they left rides along in the same cookie, because it is the same
 * in-flight login and deserves the same ten minutes and the same single
 * clearing. Sign-in starts from the menu on any page now, so "back" is no
 * longer a fixed address. It comes from the referer, which a same-origin
 * navigation sends in full; where a browser withholds it, the login ends on
 * the front page rather than failing.
 */
export const GET: APIRoute = ({ request }) => {
  const state = crypto.randomUUID();
  const from = encodeURIComponent(refererPath(request));
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", AUTH.clientId);
  authorize.searchParams.set("scope", AUTH.scope);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set(
    "redirect_uri",
    new URL("/auth/github/callback", request.url).href,
  );

  return new Response(null, {
    status: 302,
    // A UUID holds no dot, so the first one is the seam.
    headers: { location: authorize.href, "set-cookie": setStateCookie(`${state}.${from}`) },
  });
};
