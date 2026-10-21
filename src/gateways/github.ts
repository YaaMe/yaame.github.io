import { AUTH } from "../config/auth.ts";
import { platform } from "../platform/index.ts";

type GithubUser = { id: number; login: string };

export async function exchangeToken(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<{ token: string } | { error: "config" | "exchange" }> {
  // The client id is a literal in this repository; the secret is placed by
  // hand on the Worker and is the half that can actually be missing.
  const secret = platform.secret("GITHUB_CLIENT_SECRET");
  if (!secret) return { error: "config" } as const;

  let token: string | undefined;
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: AUTH.clientId,
        client_secret: secret,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });
    // GitHub answers 200 with `{"error": …}` for a spent or forged code, so
    // the status says nothing on its own.
    const body = (await res.json()) as { access_token?: string };
    token = body.access_token;
  } catch {
    return { error: "exchange" } as const;
  }
  if (!token) return { error: "exchange" } as const;

  return { token };
}

export async function githubUser(token: string): Promise<GithubUser | null> {
  let user: GithubUser;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        // GitHub rejects an API request without one.
        "user-agent": "blogu",
      },
    });
    if (!res.ok) return null;
    user = await res.json();
  } catch {
    return null;
  }
  if (typeof user.id !== "number" || !user.login) return null;

  return user;
}

export function authorizeUrl(state: string, challenge: string, redirectUri: string): string {
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", AUTH.clientId);
  authorize.searchParams.set("scope", AUTH.scope);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  return authorize.href;
}
