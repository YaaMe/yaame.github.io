import type { APIRoute } from "astro";
import { AUTH } from "../config";
import { setStateCookie } from "../session";

export const prerender = false;

/**
 * Hand the visitor to GitHub.
 *
 * The `state` is minted here and kept in a cookie the callback compares
 * against. Without it, a link from anywhere could complete a login in someone
 * else's browser: the callback would see a code, exchange it, and set a
 * session the visitor never asked for.
 */
export const GET: APIRoute = ({ request }) => {
  const state = crypto.randomUUID();
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
    headers: { location: authorize.href, "set-cookie": setStateCookie(state) },
  });
};
