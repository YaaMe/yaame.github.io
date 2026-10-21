import { AUTH } from "../config/auth.ts";
import { SESSION_COOKIE, STATE_COOKIE, VERIFIER_COOKIE, encodeState } from "../params/auth-cookies.ts";

const OAUTH_COOKIE_MAX_AGE = 600;

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
  `${SESSION_COOKIE}=${id}; ${attrs(AUTH.sessionDays * 86400)}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; ${attrs(0)}`;
export const setStateCookie = (state: string, from: string) =>
  `${STATE_COOKIE}=${encodeState(state, from)}; ${attrs(OAUTH_COOKIE_MAX_AGE, "/auth")}`;
export const clearStateCookie = () => `${STATE_COOKIE}=; ${attrs(0, "/auth")}`;
export const setVerifierCookie = (value: string) =>
  `${VERIFIER_COOKIE}=${value}; ${attrs(OAUTH_COOKIE_MAX_AGE, "/auth")}`;
export const clearVerifierCookie = () => `${VERIFIER_COOKIE}=; ${attrs(0, "/auth")}`;
