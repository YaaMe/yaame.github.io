import { base64url, randomToken } from "../../lib/encoding.ts";
import { authorizeUrl } from "../../gateways/github.ts";

export async function beginLogin(redirectUri: string) {
  const state = crypto.randomUUID();
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const url = authorizeUrl(state, base64url(new Uint8Array(digest)), redirectUri);
  return { state, verifier, url };
}

/**
 * The state check comes first and is unconditional. It proves that this
 * callback carries the state value issued for the login flow, but state is
 * held in a client cookie: clearing it cannot stop a copied, still-live cookie
 * from being presented again. PKCE binds the code exchange to the verifier in
 * the companion cookie.
 */
export function checkCallback({ state, expected, code, verifier }: {
  state: string | null;
  expected: string | null;
  code: string | null;
  verifier: string | null;
}): { code: string; verifier: string } | { error: "state" | "code" | "verifier" } {
  if (!state || !expected || state !== expected) return { error: "state" };
  if (!code) return { error: "code" };
  if (!verifier) return { error: "verifier" };
  return { code, verifier };
}
