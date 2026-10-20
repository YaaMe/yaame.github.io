import type { APIRoute } from "astro";
import { AUTH } from "../../../config/auth.ts";
import { refererPath, setStateCookie, setVerifierCookie } from "../session-core.ts";

export const prerender = false;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const verifier = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
};

const challenge = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64url(new Uint8Array(digest));
};

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
  const state = crypto.randomUUID();
  const codeVerifier = verifier();
  const from = encodeURIComponent(refererPath(request));
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", AUTH.clientId);
  authorize.searchParams.set("scope", AUTH.scope);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set(
    "redirect_uri",
    new URL("/auth/github/callback", request.url).href,
  );
  authorize.searchParams.set("code_challenge", await challenge(codeVerifier));
  authorize.searchParams.set("code_challenge_method", "S256");

  const headers = new Headers({ location: authorize.href });
  // A UUID holds no dot, so the first one is the seam.
  headers.append("set-cookie", setStateCookie(`${state}.${from}`));
  headers.append("set-cookie", setVerifierCookie(codeVerifier));
  return new Response(null, {
    status: 302,
    headers,
  });
};
