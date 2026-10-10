import test from "node:test";
import assert from "node:assert/strict";
import { AUTH, roleOf } from "../src/integrations/auth/config.ts";
import { callbackResponse } from "../src/integrations/auth/routes/callback-handler.ts";
import { logoutResponse } from "../src/integrations/auth/routes/logout-handler.ts";
import {
  clearSessionCookie,
  clearStateCookie,
  currentSession,
  sessionKey,
  setStateCookie,
} from "../src/integrations/auth/session-core.ts";

const origin = "https://blogu.yaame.dev";

function cookieValue(setCookie) {
  return setCookie.slice(0, setCookie.indexOf(";"));
}

function responseCookies(response) {
  return response.headers.getSetCookie();
}

function githubFetcher(calls) {
  return async (input) => {
    calls.push(String(input));
    if (String(input).includes("access_token")) {
      return new Response(JSON.stringify({ access_token: "token" }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: AUTH.owner.id, login: AUTH.owner.login }), {
      headers: { "content-type": "application/json" },
    });
  };
}

function storeForTest() {
  const records = new Map();
  let next = 0;
  return {
    records,
    store: {
      secret: () => "test-secret",
      async create(user) {
        const id = `session-${++next}`;
        records.set(id, user);
        return id;
      },
    },
  };
}

test("OAuth callback rejects missing and mismatched state before exchange", async () => {
  for (const cookie of [undefined, cookieValue(setStateCookie("expected./"))]) {
    const calls = [];
    const { records, store } = storeForTest();
    const request = new Request(`${origin}/auth/github/callback?code=code&state=actual`, {
      headers: cookie ? { cookie } : {},
    });

    const response = await callbackResponse({
      request,
      store,
      fetcher: githubFetcher(calls),
    });

    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "state");
    assert.deepEqual(responseCookies(response), [clearStateCookie()]);
    assert.deepEqual(calls, []);
    assert.equal(records.size, 0);
  }
});

test("OAuth callback rejects a missing code after state validation", async () => {
  const calls = [];
  const { records, store } = storeForTest();
  const request = new Request(`${origin}/auth/github/callback?state=state`, {
    headers: { cookie: cookieValue(setStateCookie("state./")) },
  });

  const response = await callbackResponse({
    request,
    store,
    fetcher: githubFetcher(calls),
  });

  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "code");
  assert.deepEqual(responseCookies(response), [clearStateCookie()]);
  assert.deepEqual(calls, []);
  assert.equal(records.size, 0);
});

test("OAuth callback sets a session, spends state, and returns to the same-site path", async () => {
  const calls = [];
  const { records, store } = storeForTest();
  const carried = cookieValue(setStateCookie(`state.${encodeURIComponent("/notes/2026?comments=1")}`));
  const request = new Request(`${origin}/auth/github/callback?code=code&state=state`, {
    headers: { cookie: carried },
  });

  const response = await callbackResponse({
    request,
    store,
    fetcher: githubFetcher(calls),
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${origin}/notes/2026?comments=1`);
  const cookies = responseCookies(response);
  assert.equal(cookies.at(-1), clearStateCookie());
  const sessionCookie = cookies.find((value) => value.startsWith("session="));
  assert.ok(sessionCookie);
  const sessionId = sessionCookie.slice("session=".length, sessionCookie.indexOf(";"));
  assert.deepEqual(records.get(sessionId), { id: AUTH.owner.id, login: AUTH.owner.login });
  assert.deepEqual(calls, [
    "https://github.com/login/oauth/access_token",
    "https://api.github.com/user",
  ]);
});

test("OAuth callback rejects a replay after the spent state cookie is cleared", async () => {
  const calls = [];
  const { records, store } = storeForTest();
  const original = cookieValue(setStateCookie("state./"));
  const first = await callbackResponse({
    request: new Request(`${origin}/auth/github/callback?code=first&state=state`, {
      headers: { cookie: original },
    }),
    store,
    fetcher: githubFetcher(calls),
  });

  assert.equal(first.status, 302);
  assert.equal(responseCookies(first).find((value) => value.startsWith("oauth_state=")), clearStateCookie());

  const replay = await callbackResponse({
    request: new Request(`${origin}/auth/github/callback?code=second&state=state`, {
      headers: { cookie: cookieValue(clearStateCookie()) },
    }),
    store,
    fetcher: githubFetcher(calls),
  });

  assert.equal(replay.status, 302);
  assert.equal(new URL(replay.headers.get("location")).searchParams.get("error"), "state");
  assert.equal(records.size, 1);
  assert.equal(calls.length, 2);
});

test("OAuth callback sends an unsafe return path to the site root", async () => {
  const { records, store } = storeForTest();
  const carried = cookieValue(setStateCookie(`state.${encodeURIComponent("//evil.example/path")}`));
  const request = new Request(`${origin}/auth/github/callback?code=code&state=state`, {
    headers: { cookie: carried },
  });

  const response = await callbackResponse({
    request,
    store,
    fetcher: githubFetcher([]),
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${origin}/`);
  assert.equal(records.size, 1);
});

test("OAuth callback rejects a replay that retains the spent state cookie", {
  todo: "state spending is client-side cookie clearing; a copied cookie is accepted",
});

test("logout destroys the session record and clears its cookie", async () => {
  const records = new Map([["session-1", { id: AUTH.owner.id, login: AUTH.owner.login }]]);
  const request = new Request(`${origin}/auth/logout`, {
    method: "POST",
    headers: { cookie: "session=session-1" },
  });
  let destroyed = false;

  const response = await logoutResponse({
    request,
    destroy: async (incoming) => {
      destroyed = true;
      const value = incoming.headers.get("cookie").split("=")[1];
      records.delete(value);
    },
    clearCookie: clearSessionCookie(),
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("location"), null);
  assert.deepEqual(responseCookies(response), [clearSessionCookie()]);
  assert.equal(destroyed, true);
  assert.equal(records.size, 0);
});

test("roleOf uses the numeric account id", () => {
  assert.equal(roleOf(AUTH.owner.id), "owner");
  assert.equal(roleOf(AUTH.owner.id + 1), "guest");
});

test("current refuses an expired session even when the store still returns it", async () => {
  const id = "expired-session";
  const key = sessionKey(id);
  const record = {
    userId: AUTH.owner.id,
    login: AUTH.owner.login,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
  };
  let readKey;
  let removedKey;

  const result = await currentSession(
    new Request(`${origin}/`, { headers: { cookie: `session=${id}` } }),
    {
      get: async (requested) => {
        readKey = requested;
        return record;
      },
      remove: async (requested) => {
        removedKey = requested;
      },
    },
    Date.parse("2026-01-03T00:00:00.000Z"),
  );

  assert.equal(result, null);
  assert.equal(readKey, key);
  assert.equal(removedKey, key);
});
