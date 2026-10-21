import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { authRuntime } from "./fixtures/auth.mjs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { sessions } from "../src/config/data.config.generated.mjs";
import { readSessionCookie } from "../src/params/auth.ts";
import { safeReturn } from "../src/services/auth/return.ts";
import { AUTH } from "../src/config/auth.ts";
import { roleOf } from "../src/services/auth/roles.ts";
import {
  clearSessionCookie,
  clearStateCookie,
  clearVerifierCookie,
  setSessionCookie,
  setVerifierCookie,
  setStateCookie,
} from "../src/schemas/auth-cookies.ts";

const sessionKey = sessions.key;
const origin = "https://blogu.yaame.dev";

function cookieValue(setCookie) {
  return setCookie.slice(0, setCookie.indexOf(";"));
}

function oauthCookies(state, verifier = "verifier-value") {
  return `oauth_state=${state}; ${cookieValue(setVerifierCookie(verifier))}`;
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

test("OAuth callback rejects missing and mismatched state before exchange", async (context) => {
  for (const cookie of [undefined, oauthCookies("expected./")]) {
    const calls = [];
    const service = await authRuntime();
    const { records } = service;
    context.mock.method(globalThis, "fetch", githubFetcher(calls));
    const request = new Request(`${origin}/auth/github/callback?code=code&state=actual`, {
      headers: cookie ? { cookie } : {},
    });

    const response = await service.callbackResponse({
      request,
    });

    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "state");
    assert.deepEqual(responseCookies(response), [clearStateCookie(), clearVerifierCookie()]);
    assert.deepEqual(calls, []);
    assert.equal(records.size, 0);
  }
});

test("OAuth callback rejects a missing code after state validation", async (context) => {
  const calls = [];
  const service = await authRuntime();
  const { records } = service;
  context.mock.method(globalThis, "fetch", githubFetcher(calls));
  const request = new Request(`${origin}/auth/github/callback?state=state`, {
    headers: { cookie: oauthCookies("state./") },
  });

  const response = await service.callbackResponse({
    request,
  });

  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "code");
  assert.deepEqual(responseCookies(response), [clearStateCookie(), clearVerifierCookie()]);
  assert.deepEqual(calls, []);
  assert.equal(records.size, 0);
});

test("OAuth callback sets a session, clears auth cookies, and returns to the same-site path", async (context) => {
  const calls = [];
  const service = await authRuntime();
  const { records } = service;
  context.mock.method(globalThis, "fetch", githubFetcher(calls));
  const carried = oauthCookies(`state.${encodeURIComponent("/notes/2026?comments=1")}`);
  const request = new Request(`${origin}/auth/github/callback?code=code&state=state`, {
    headers: { cookie: carried },
  });

  const response = await service.callbackResponse({
    request,
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${origin}/notes/2026?comments=1`);
  const cookies = responseCookies(response);
  assert.equal(cookies.at(-2), clearStateCookie());
  assert.equal(cookies.at(-1), clearVerifierCookie());
  const sessionCookie = cookies.find((value) => value.startsWith("session="));
  assert.ok(sessionCookie);
  const sessionId = sessionCookie.slice("session=".length, sessionCookie.indexOf(";"));
  assert.equal(records.get(sessionKey(sessionId)).userId, AUTH.owner.id);
  assert.equal(records.get(sessionKey(sessionId)).login, AUTH.owner.login);
  assert.deepEqual(calls.map(({ input }) => input), [
    "https://github.com/login/oauth/access_token",
    "https://api.github.com/user",
  ]);
  assert.equal(JSON.parse(calls[0].init.body).code_verifier, "verifier-value");
});

test("OAuth callback rejects a replay after the state cookie is cleared", async (context) => {
  const calls = [];
  const service = await authRuntime();
  const { records } = service;
  context.mock.method(globalThis, "fetch", githubFetcher(calls));
  const original = oauthCookies("state./");
  const first = await service.callbackResponse({
    request: new Request(`${origin}/auth/github/callback?code=first&state=state`, {
      headers: { cookie: original },
    }),
  });

  assert.equal(first.status, 302);
  assert.equal(responseCookies(first).find((value) => value.startsWith("oauth_state=")), clearStateCookie());

  const replay = await service.callbackResponse({
    request: new Request(`${origin}/auth/github/callback?code=second&state=state`, {
      headers: { cookie: cookieValue(clearStateCookie()) },
    }),
  });

  assert.equal(replay.status, 302);
  assert.equal(new URL(replay.headers.get("location")).searchParams.get("error"), "state");
  assert.equal(records.size, 1);
  assert.equal(calls.length, 2);
});

test("OAuth callback sends an unsafe return path to the site root", async (context) => {
  const calls = [];
  const service = await authRuntime();
  const { records } = service;
  context.mock.method(globalThis, "fetch", githubFetcher(calls));
  const carried = oauthCookies(`state.${encodeURIComponent("//evil.example/path")}`);
  const request = new Request(`${origin}/auth/github/callback?code=code&state=state`, {
    headers: { cookie: carried },
  });

  const response = await service.callbackResponse({
    request,
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${origin}/`);
  assert.equal(records.size, 1);
});

test("OAuth callback rejects a missing verifier cookie before exchange", async (context) => {
  const calls = [];
  const service = await authRuntime();
  const { records } = service;
  context.mock.method(globalThis, "fetch", githubFetcher(calls));
  const request = new Request(`${origin}/auth/github/callback?code=code&state=state`, {
    headers: { cookie: cookieValue(setStateCookie("state", "/")) },
  });

  const response = await service.callbackResponse({
    request,
  });

  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "verifier");
  assert.deepEqual(responseCookies(response), [clearStateCookie(), clearVerifierCookie()]);
  assert.deepEqual(calls, []);
  assert.equal(records.size, 0);
});

test("OAuth login redirect uses an S256 challenge for its verifier cookie", async () => {
  const service = await authRuntime();
  const response = await service.githubLogin({
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
  const service = await authRuntime();
  const id = await service.create({ id: AUTH.owner.id, login: AUTH.owner.login });
  const response = await service.logoutRoute.POST({
    request: new Request(`${origin}/auth/logout`, {
      method: "POST",
      headers: { cookie: cookieValue(setSessionCookie(id)) },
    }),
  });

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("location"), null);
  assert.deepEqual(responseCookies(response), [clearSessionCookie()]);
  assert.deepEqual(service.removed, [sessionKey(id)]);
  assert.equal(await service.current(id), null);
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
  const service = await authRuntime();
  const id = "expired-session";
  service.records.set(sessionKey(id), expiredRecord);
  service.faults.put = () => assert.fail("a read must not put");
  service.faults.remove = () => assert.fail("a read must not remove");

  const result = await service.readSession(id, Date.parse("2026-01-03T00:00:00.000Z"));

  assert.deepEqual(result, { state: "expired", id });
  assert.deepEqual(service.reads, [sessionKey(id)]);
  assert.deepEqual(service.writes, []);
  assert.deepEqual(service.removed, []);
});

test("readSession distinguishes absent, expired and active", async () => {
  const service = await authRuntime();
  const active = { ...expiredRecord, expiresAt: "2026-01-04T00:00:00.000Z" };
  service.records.set(sessionKey("active"), active);
  service.records.set(sessionKey("expired"), expiredRecord);
  const now = Date.parse("2026-01-03T00:00:00.000Z");

  assert.deepEqual(await service.readSession(null, now), { state: "absent" });
  assert.deepEqual(service.reads, []);
  assert.deepEqual(await service.readSession("missing", now), { state: "absent" });
  assert.deepEqual(await service.readSession("expired", now), { state: "expired", id: "expired" });
  assert.deepEqual(await service.readSession("active", now), {
    state: "active", session: { ...active, role: roleOf(AUTH.owner.id) },
  });
  const atExpiry = Date.parse(expiredRecord.expiresAt);
  assert.equal((await service.readSession("expired", atExpiry - 1)).state, "active");
  assert.equal((await service.readSession("expired", atExpiry)).state, "expired");
});

test("current removes exactly the expired record and reports no session", async () => {
  const service = await authRuntime();
  const neighbour = { ...expiredRecord, expiresAt: "2999-01-01T00:00:00.000Z" };
  service.records.set(sessionKey("expired"), expiredRecord);
  service.records.set(sessionKey("neighbour"), neighbour);

  assert.equal(await service.current("expired"), null);
  assert.deepEqual(service.removed, [sessionKey("expired")]);
  assert.equal(service.records.has(sessionKey("expired")), false);
  assert.deepEqual(service.records.get(sessionKey("neighbour")), neighbour);
});

test("current still reports no session when removing the expired record fails, and logs neither key nor id", async () => {
  const service = await authRuntime();
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
    result = await service.current(id);
  } finally {
    Object.assign(console, saved);
  }

  assert.equal(result, null);
  assert.equal(service.records.has(key), true);
  assert.ok(logged.length > 0, "a failed removal is logged");
  const text = inspect(logged, { depth: Infinity, showHidden: true });
  assert.ok(!text.includes(id), "the log carries the session id");
  assert.ok(!text.includes(key), "the log carries the session key");
});

test("current removes nothing for an active or absent session", async () => {
  const service = await authRuntime();
  const active = { ...expiredRecord, expiresAt: "2999-01-01T00:00:00.000Z" };
  service.records.set(sessionKey("active"), active);

  assert.deepEqual(await service.current("active"), {
    ...active,
    role: roleOf(active.userId),
  });
  assert.equal(await service.current("missing"), null);
  assert.equal(await service.current(null), null);
  assert.deepEqual(service.removed, []);
  assert.deepEqual(service.records.get(sessionKey("active")), active);
});

test("create stores a session that current reads back, and destroy removes it", async () => {
  const service = await authRuntime();
  const id = await service.create({ id: AUTH.owner.id, login: AUTH.owner.login });

  const session = await service.current(id);
  assert.equal(session.userId, AUTH.owner.id);
  assert.equal(session.login, AUTH.owner.login);
  assert.equal(session.role, "owner");
  const stored = service.records.get(sessionKey(id));
  assert.deepEqual(Object.keys(stored).sort(), ["createdAt", "expiresAt", "login", "userId"]);
  assert.equal(Date.parse(stored.expiresAt) - Date.parse(stored.createdAt), AUTH.sessionDays * 86400_000);
  assert.equal(service.writes[0].options.ttl, AUTH.sessionDays * 86400);

  await service.destroy(id);
  assert.deepEqual(service.removed, [sessionKey(id)]);
  assert.equal(await service.current(id), null);
});

test("current applies allow-list changes on later reads of the same session", async () => {
  const service = await authRuntime();
  const user = { id: AUTH.owner.id + 1, login: AUTH.owner.login };
  service.AUTH.allow.splice(0);
  const id = await service.create(user);
  const credential = readSessionCookie(sessionRequest(id));
  const stored = { ...service.records.get(sessionKey(id)) };

  assert.deepEqual(await service.current(credential), { ...stored, role: "guest" });

  service.AUTH.allow.push(user);
  assert.deepEqual(await service.current(credential), { ...stored, role: "allowed" });

  service.AUTH.allow.pop();
  assert.deepEqual(await service.current(credential), { ...stored, role: "guest" });
  assert.deepEqual(service.records.get(sessionKey(id)), stored);
  assert.equal(Object.hasOwn(stored, "role"), false);
  assert.deepEqual(service.removed, []);
});

test("OAuth failures clear flow cookies and create no session", async (context) => {
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const cases = [
    { error: "config", configured: false, responses: [] },
    { error: "exchange", responses: [() => { throw new Error("exchange unavailable"); }] },
    { error: "exchange", responses: [() => new Response("invalid JSON")] },
    { error: "exchange", responses: [() => json({ error: "bad_verification_code" })] },
    { error: "user", responses: [() => json({ access_token: "token" }), () => json({}, 401)] },
    { error: "user", responses: [() => json({ access_token: "token" }), () => { throw new Error("user unavailable"); }] },
    { error: "user", responses: [() => json({ access_token: "token" }), () => new Response("invalid JSON")] },
    { error: "user", responses: [() => json({ access_token: "token" }), () => json({ id: "42", login: "reader" })] },
    { error: "user", responses: [() => json({ access_token: "token" }), () => json({ id: 42 })] },
  ];
  for (const scenario of cases) {
    const service = await authRuntime();
    service.settings.configured = scenario.configured ?? true;
    let calls = 0;
    const fetch = context.mock.method(globalThis, "fetch", async () => {
      const respond = scenario.responses[calls++];
      assert.ok(respond, "no further request may follow a failed exchange or lookup");
      return respond();
    });
    const response = await service.callbackResponse({
      request: new Request(`${origin}/auth/github/callback?code=code&state=state`, {
        headers: { cookie: oauthCookies("state./") },
      }),
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${origin}/login?error=${scenario.error}`);
    assert.deepEqual(responseCookies(response), [clearStateCookie(), clearVerifierCookie()]);
    assert.equal(service.records.size, 0);
    assert.deepEqual(service.writes, []);
    assert.equal(calls, scenario.responses.length);
    fetch.mock.restore();
  }
});

test("safeReturn preserves encoded site paths and refuses redirect escapes", () => {
  for (const value of [null, "", "https://evil.example/", "//evil.example/", "/\\evil.example/",
    "/%2Fevil.example/", "/%5Cevil.example/", "/\r\nLocation: evil", "/%0d%0aevil", "/%7f", "/%",
    "/auth", "/auth/github", "/%61uth/github"]) {
    assert.equal(safeReturn(value), "/");
  }
  for (const value of ["/", "/notes/2026/?page=2", "/posts/a%2Fb/?x=%25", "/posts/one/#comments"]) {
    assert.equal(safeReturn(value), value);
  }
});

test("the callback decodes the carried path once and keeps encoded segments", async (context) => {
  for (const [carried, expected] of [
    [`state.${encodeURIComponent("/posts/a%2Fb/?x=%25")}`, "/posts/a%2Fb/?x=%25"],
    ["state.%", "/"],
    ["state", "/"],
  ]) {
    const service = await authRuntime();
    context.mock.method(globalThis, "fetch", githubFetcher([]));
    const response = await service.callbackResponse({ request: new Request(
      `${origin}/auth/github/callback?code=code&state=state`,
      { headers: { cookie: oauthCookies(carried) } },
    ) });
    assert.equal(response.headers.get("location"), `${origin}${expected}`);
    assert.equal(service.records.size, 1);
  }
});

test("login start carries only a safe same-origin return path", async () => {
  const service = await authRuntime();
  for (const [referer, expected] of [
    [undefined, "/"], ["invalid", "/"], ["https://evil.example/notes/", "/"],
    [`${origin}/auth/github`, "/"], [`${origin}/notes/2026/?page=2#comments`, "/notes/2026/?page=2"],
  ]) {
    const response = await service.githubLogin({ request: new Request(`${origin}/auth/github`, {
      headers: referer ? { referer } : {},
    }) });
    const to = new URL(response.headers.get("location"));
    assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(to.searchParams.get("client_id"), AUTH.clientId);
    assert.equal(to.searchParams.get("scope"), "read:user");
    assert.equal(to.searchParams.get("redirect_uri"), `${origin}/auth/github/callback`);
    const stateCookie = responseCookies(response).find((value) => value.startsWith("oauth_state="));
    const state = cookieValue(stateCookie).slice("oauth_state=".length);
    assert.equal(state, `${to.searchParams.get("state")}.${encodeURIComponent(expected)}`);
  }
  assert.deepEqual(service.reads, []);
  assert.deepEqual(service.writes, []);
});

test("auth cookies retain scope, lifetime and navigation attributes", () => {
  assert.equal(
    cookieValue(setStateCookie("state", "/posts/a.b%2Fc/?q=%25")),
    "oauth_state=state.%2Fposts%2Fa.b%252Fc%2F%3Fq%3D%2525",
  );
  const attributes = (value) => value.slice(value.indexOf(";") + 2);
  assert.equal(attributes(setSessionCookie("fixture")), "Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000");
  assert.equal(attributes(clearSessionCookie()), "Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  for (const value of [setStateCookie("fixture", "/"), setVerifierCookie("fixture")]) {
    assert.equal(attributes(value), "Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600");
  }
  for (const clear of [clearStateCookie, clearVerifierCookie]) {
    assert.equal(attributes(clear()), "Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  }
});

test("session reads and revocation propagate storage failures", async () => {
  const service = await authRuntime();
  service.faults.get = () => new Error("read unavailable");
  await assert.rejects(service.current("fixture"), /read unavailable/);
  service.faults.remove = () => new Error("revocation unavailable");
  await assert.rejects(service.logoutRoute.POST({ request: new Request(`${origin}/auth/logout`, {
    method: "POST", headers: { cookie: "session=fixture" },
  }) }), /revocation unavailable/);
  await service.destroy(null);
  assert.deepEqual(service.writes, []);
});

test("the real logout route admits POST only", async () => {
  const service = await authRuntime();
  const container = await AstroContainer.create();
  const id = await service.create({ id: AUTH.owner.id, login: AUTH.owner.login });
  for (const method of ["GET", "HEAD"]) {
    const response = await container.renderToResponse(service.logoutRoute, {
      routeType: "endpoint",
      request: new Request(`${origin}/auth/logout`, { method, headers: { cookie: cookieValue(setSessionCookie(id)) } }),
    });
    assert.equal(response.status, 404);
    assert.equal(service.records.has(sessionKey(id)), true);
  }
  assert.deepEqual(service.removed, []);
  const response = await container.renderToResponse(service.logoutRoute, {
    routeType: "endpoint",
    request: new Request(`${origin}/auth/logout`, {
      method: "POST", headers: { cookie: cookieValue(setSessionCookie(id)) },
    }),
  });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(service.records.has(sessionKey(id)), false);
});

test("the login entrance renders prepared labels through its real component", async () => {
  const service = await authRuntime({ render: true });
  const container = await AstroContainer.create();
  const id = await service.create({ id: AUTH.owner.id, login: "reader<&>" });
  const html = await container.renderToString(service.Login, {
    request: new Request(`${origin}/login?error=verifier`, { headers: { cookie: cookieValue(setSessionCookie(id)) } }),
  });
  assert.match(html, /@reader&lt;&amp;&gt;/);
  assert.match(html, /站长/);
  assert.match(html, /登录凭据不完整/);
  assert.match(html, /id="logout"/);
  assert.match(html, /fetch\("\/auth\/logout", \{ method: "POST" \}\)/);
  assert.match(html, /finally \{ location.reload\(\); \}/);
  assert.deepEqual(service.reads, [sessionKey(id)]);
  assert.ok(!html.includes(id), "the page must not print the credential");

  const signedOut = await container.renderToString(service.Login, {
    request: new Request(`${origin}/login?error=unknown`),
  });
  assert.match(signedOut, /登录没有完成。/);
  assert.match(signedOut, /href="\/auth\/github"/);
  assert.doesNotMatch(signedOut, /id="logout"/);
  assert.deepEqual(service.reads, [sessionKey(id)]);
});

test("the session island resolves its own cookie and sends a private response", async () => {
  const service = await authRuntime({ render: true });
  const container = await AstroContainer.create();
  const id = await service.create({ id: AUTH.owner.id, login: "reader<&>" });
  const render = (credential) => container.renderToResponse(service.Island, {
    request: sessionRequest(credential), locals: { session: { login: "untrusted" } },
  });
  const active = await render(id);
  assert.equal(active.headers.get("cache-control"), "private, no-store");
  const html = await active.text();
  assert.match(html, /@reader&lt;&amp;&gt;/);
  assert.match(html, /data-session-logout/);
  assert.ok(!html.includes(id), "the island must not print the credential");
  await service.destroy(id);
  const revoked = await render(id);
  assert.equal(revoked.headers.get("cache-control"), "private, no-store");
  assert.match(await revoked.text(), /href="\/auth\/github"/);
  const absent = await render(null);
  assert.doesNotMatch(await absent.text(), /untrusted/);

  service.records.set(sessionKey("expired"), expiredRecord);
  const expired = await render("expired");
  assert.match(await expired.text(), /href="\/auth\/github"/);
  assert.equal(service.records.has(sessionKey("expired")), false);
});
