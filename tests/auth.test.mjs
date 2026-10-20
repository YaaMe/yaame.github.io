import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { build } from "esbuild";
import { AUTH } from "../src/integrations/auth/config.ts";
import { roleOf } from "../src/services/auth/roles.ts";
import { callbackResponse } from "../src/integrations/auth/routes/callback-handler.ts";
import { GET as githubLogin } from "../src/integrations/auth/routes/github.ts";
import { logoutResponse } from "../src/integrations/auth/routes/logout-handler.ts";
import {
  clearSessionCookie,
  clearStateCookie,
  clearVerifierCookie,
  readSession,
  sessionKey,
  setVerifierCookie,
  setStateCookie,
} from "../src/integrations/auth/session-core.ts";

const origin = "https://blogu.yaame.dev";

function cookieValue(setCookie) {
  return setCookie.slice(0, setCookie.indexOf(";"));
}

function oauthCookies(state, verifier = "verifier-value") {
  return `${cookieValue(setStateCookie(state))}; ${cookieValue(setVerifierCookie(verifier))}`;
}

function responseCookies(response) {
  return response.headers.getSetCookie();
}

function githubFetcher(calls) {
  return async (input, init) => {
    calls.push({ input: String(input), init });
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
  for (const cookie of [undefined, oauthCookies("expected./")]) {
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
    assert.deepEqual(responseCookies(response), [clearStateCookie(), clearVerifierCookie()]);
    assert.deepEqual(calls, []);
    assert.equal(records.size, 0);
  }
});

test("OAuth callback rejects a missing code after state validation", async () => {
  const calls = [];
  const { records, store } = storeForTest();
  const request = new Request(`${origin}/auth/github/callback?state=state`, {
    headers: { cookie: oauthCookies("state./") },
  });

  const response = await callbackResponse({
    request,
    store,
    fetcher: githubFetcher(calls),
  });

  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "code");
  assert.deepEqual(responseCookies(response), [clearStateCookie(), clearVerifierCookie()]);
  assert.deepEqual(calls, []);
  assert.equal(records.size, 0);
});

test("OAuth callback sets a session, clears auth cookies, and returns to the same-site path", async () => {
  const calls = [];
  const { records, store } = storeForTest();
  const carried = oauthCookies(`state.${encodeURIComponent("/notes/2026?comments=1")}`);
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
  assert.equal(cookies.at(-2), clearStateCookie());
  assert.equal(cookies.at(-1), clearVerifierCookie());
  const sessionCookie = cookies.find((value) => value.startsWith("session="));
  assert.ok(sessionCookie);
  const sessionId = sessionCookie.slice("session=".length, sessionCookie.indexOf(";"));
  assert.deepEqual(records.get(sessionId), { id: AUTH.owner.id, login: AUTH.owner.login });
  assert.deepEqual(calls.map(({ input }) => input), [
    "https://github.com/login/oauth/access_token",
    "https://api.github.com/user",
  ]);
  assert.equal(JSON.parse(calls[0].init.body).code_verifier, "verifier-value");
});

test("OAuth callback rejects a replay after the state cookie is cleared", async () => {
  const calls = [];
  const { records, store } = storeForTest();
  const original = oauthCookies("state./");
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
  const carried = oauthCookies(`state.${encodeURIComponent("//evil.example/path")}`);
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

test("OAuth callback rejects a missing verifier cookie before exchange", async () => {
  const calls = [];
  const { records, store } = storeForTest();
  const request = new Request(`${origin}/auth/github/callback?code=code&state=state`, {
    headers: { cookie: cookieValue(setStateCookie("state./")) },
  });

  const response = await callbackResponse({
    request,
    store,
    fetcher: githubFetcher(calls),
  });

  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "verifier");
  assert.deepEqual(responseCookies(response), [clearStateCookie(), clearVerifierCookie()]);
  assert.deepEqual(calls, []);
  assert.equal(records.size, 0);
});

test("OAuth login redirect uses an S256 challenge for its verifier cookie", async () => {
  const response = await githubLogin({
    request: new Request(`${origin}/auth/github`, {
      headers: { referer: `${origin}/notes/2026` },
    }),
  });

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  const cookies = responseCookies(response);
  const verifierCookie = cookies.find((value) => value.startsWith("oauth_verifier="));
  assert.ok(verifierCookie);
  const verifier = cookieValue(verifierCookie).slice("oauth_verifier=".length);
  assert.match(verifier, /^[A-Za-z0-9._~-]{43}$/);
  assert.equal(verifierCookie, setVerifierCookie(verifier));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(location.searchParams.get("code_challenge"), challenge);
  assert.equal(location.searchParams.get("code_verifier"), null);
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

test("roleOf resolves owner, allow-listed and guest identities by numeric id", (context) => {
  const originalAllow = [...AUTH.allow];
  context.after(() => AUTH.allow.splice(0, AUTH.allow.length, ...originalAllow));
  const allowedId = AUTH.owner.id + 1;
  AUTH.allow.splice(0, AUTH.allow.length,
    { id: AUTH.owner.id, login: "renamed-owner" },
    { id: allowedId, login: AUTH.owner.login },
  );

  assert.equal(roleOf(AUTH.owner.id), "owner");
  assert.equal(roleOf(allowedId), "allowed");
  assert.equal(roleOf(allowedId + 1), "guest");
});

const expiredRecord = {
  userId: AUTH.owner.id,
  login: AUTH.owner.login,
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-02T00:00:00.000Z",
};

function sessionRequest(id) {
  return new Request(`${origin}/`, id ? { headers: { cookie: `session=${id}` } } : {});
}

test("readSession reports an expired record without writing to the store", async () => {
  const id = "expired-session";
  const reads = [];
  const store = {
    get: async (key) => {
      reads.push(key);
      return expiredRecord;
    },
    put: async () => assert.fail("a read must not put"),
    remove: async () => assert.fail("a read must not remove"),
  };

  const result = await readSession(sessionRequest(id), store, Date.parse("2026-01-03T00:00:00.000Z"));

  assert.deepEqual(result, { state: "expired", key: sessionKey(id) });
  assert.deepEqual(reads, [sessionKey(id)]);
});

test("readSession distinguishes absent, expired and active", async () => {
  const records = new Map([
    [sessionKey("active"), { ...expiredRecord, expiresAt: "2026-01-04T00:00:00.000Z" }],
    [sessionKey("expired"), expiredRecord],
  ]);
  const store = { get: async (key) => records.get(key) ?? null };
  const now = Date.parse("2026-01-03T00:00:00.000Z");

  assert.deepEqual(await readSession(sessionRequest(null), store, now), { state: "absent" });
  assert.deepEqual(await readSession(sessionRequest("missing"), store, now), { state: "absent" });
  assert.deepEqual(await readSession(sessionRequest("expired"), store, now), {
    state: "expired",
    key: sessionKey("expired"),
  });
  assert.deepEqual(await readSession(sessionRequest("active"), store, now), {
    state: "active",
    session: { ...records.get(sessionKey("active")), role: roleOf(AUTH.owner.id) },
  });
  // The boundary: a record whose expiry is now has ended.
  const atExpiry = Date.parse(expiredRecord.expiresAt);
  assert.equal((await readSession(sessionRequest("expired"), store, atExpiry)).state, "expired");
});

/**
 * The service as built: its `virtual:platform` import resolves to a Map-backed
 * fake that records every removal, so the test sees what the service asks the
 * host to delete.
 */
let serviceLoads = 0;

async function sessionService() {
  const bundle = await build({
    stdin: {
      contents: `
        export { create, current, destroy } from "./session";
        export { AUTH } from "../integrations/auth/config";
        export { records, removed, faults } from "virtual:platform";
      `,
      resolveDir: fileURLToPath(new URL("../src/services/", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "session-platform-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^virtual:platform$/ }, () => ({ path: "platform", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
            export const records = new Map();
            export const removed = [];
            export const faults = { remove: null };
            export const platform = {
              get: async (key) => records.get(key) ?? null,
              put: async (key, value) => { records.set(key, value); },
              remove: async (key) => {
                if (faults.remove) throw faults.remove(key);
                removed.push(key);
                records.delete(key);
              },
            };
          `,
        }));
      },
    }],
  });
  // A distinct source per call: an identical data URL returns the cached
  // module, and with it another test's records.
  const source = `${bundle.outputFiles[0].text}\n// ${++serviceLoads}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("current removes exactly the expired record and reports no session", async () => {
  const service = await sessionService();
  const neighbour = { ...expiredRecord, expiresAt: "2999-01-01T00:00:00.000Z" };
  service.records.set(sessionKey("expired"), expiredRecord);
  service.records.set(sessionKey("neighbour"), neighbour);

  assert.equal(await service.current(sessionRequest("expired")), null);
  assert.deepEqual(service.removed, [sessionKey("expired")]);
  assert.equal(service.records.has(sessionKey("expired")), false);
  assert.deepEqual(service.records.get(sessionKey("neighbour")), neighbour);
});

test("current still reports no session when removing the expired record fails, and logs neither key nor id", async () => {
  const service = await sessionService();
  const id = "expired-credential";
  const key = sessionKey(id);
  service.records.set(key, expiredRecord);
  // Shaped like a Node filesystem error, whose message names the file and so the key.
  service.faults.remove = (failing) =>
    Object.assign(new Error(`EACCES: permission denied, unlink '/data/${failing}.json'`), { code: "EACCES" });

  const logged = [];
  const saved = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  for (const level of Object.keys(saved)) console[level] = (...args) => logged.push(args);
  let result;
  try {
    result = await service.current(sessionRequest(id));
  } finally {
    Object.assign(console, saved);
  }

  assert.equal(result, null);
  assert.equal(service.records.has(key), true);
  assert.ok(logged.length > 0, "a failed removal is logged");
  const text = inspect(logged, { depth: Infinity, showHidden: true });
  assert.ok(!text.includes(id), `the log carries the session id: ${text}`);
  assert.ok(!text.includes(key), `the log carries the session key: ${text}`);
});

test("current removes nothing for an active or absent session", async () => {
  const service = await sessionService();
  const active = { ...expiredRecord, expiresAt: "2999-01-01T00:00:00.000Z" };
  service.records.set(sessionKey("active"), active);

  assert.deepEqual(await service.current(sessionRequest("active")), {
    ...active,
    role: roleOf(active.userId),
  });
  assert.equal(await service.current(sessionRequest("missing")), null);
  assert.equal(await service.current(sessionRequest(null)), null);
  assert.deepEqual(service.removed, []);
  assert.deepEqual(service.records.get(sessionKey("active")), active);
});

test("create stores a session that current reads back, and destroy removes it", async () => {
  const service = await sessionService();
  const id = await service.create({ id: AUTH.owner.id, login: AUTH.owner.login });

  const session = await service.current(sessionRequest(id));
  assert.equal(session.userId, AUTH.owner.id);
  assert.equal(session.login, AUTH.owner.login);
  assert.equal(session.role, "owner");

  await service.destroy(sessionRequest(id));
  assert.deepEqual(service.removed, [sessionKey(id)]);
  assert.equal(await service.current(sessionRequest(id)), null);
});

test("current applies allow-list changes on later reads of the same session", async () => {
  const service = await sessionService();
  const user = { id: AUTH.owner.id + 1, login: AUTH.owner.login };
  service.AUTH.allow.splice(0);
  const id = await service.create(user);
  const request = sessionRequest(id);
  const stored = { ...service.records.get(sessionKey(id)) };

  assert.deepEqual(await service.current(request), { ...stored, role: "guest" });

  service.AUTH.allow.push(user);
  assert.deepEqual(await service.current(request), { ...stored, role: "allowed" });

  service.AUTH.allow.pop();
  assert.deepEqual(await service.current(request), { ...stored, role: "guest" });
  assert.deepEqual(service.records.get(sessionKey(id)), stored);
  assert.equal(Object.hasOwn(stored, "role"), false);
  assert.deepEqual(service.removed, []);
});
