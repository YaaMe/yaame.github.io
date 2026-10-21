import type { APIRoute } from "astro";
import { callbackParams } from "../../params/auth.ts";
import { clearStateCookie, clearVerifierCookie, setSessionCookie } from "../../schemas/auth-cookies.ts";
import { githubCallbackUrl } from "../../schemas/auth-urls.ts";
import { checkCallback } from "../../services/auth/oauth.ts";
import { loginWithGithub } from "../../services/auth/login.ts";
import { safeReturn } from "../../services/auth/return.ts";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const input = callbackParams(request);
  /**
   * Where to go next.
   *
   * A failure goes to /login, which is the only page that can explain one. A
   * success goes back to whatever page the visitor left — carried through the
   * round trip in the state cookie, and refused by `safeReturn` unless it is a
   * path on this site.
   */
  const back = (to: string) => new URL(to, request.url).href;
  const failTo = (error: string) => {
    const to = new URL("/login", request.url);
    to.searchParams.set("error", error);
    return to.href;
  };
  const fail = (why: string) => {
    const headers = new Headers({ location: failTo(why) });
    headers.append("set-cookie", clearStateCookie());
    headers.append("set-cookie", clearVerifierCookie());
    return new Response(null, { status: 302, headers });
  };

  const checked = checkCallback(input);
  if ("error" in checked) return fail(checked.error);
  const result = await loginWithGithub(
    checked.code,
    checked.verifier,
    githubCallbackUrl(request.url),
  );
  if ("error" in result) return fail(result.error);

  const headers = new Headers({ location: back(safeReturn(input.from)) });
  headers.append("set-cookie", setSessionCookie(result.id));
  headers.append("set-cookie", clearStateCookie());
  headers.append("set-cookie", clearVerifierCookie());
  return new Response(null, { status: 302, headers });
};
