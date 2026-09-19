#!/usr/bin/env node
/**
 * Conformance check against the endpoints that are actually being served.
 *
 * It asserts what a consumer reads and what breaks when a field is missing, not
 * whether this code does what it was written to do. An omission is invisible in
 * our own output: only an external reference shows it.
 *
 *   node scripts/ap-check.mjs [base-url] [user]
 *
 * Non-zero exit on failure. Absences that are choices are reported and do not
 * fail — they are a person's to make, and the job here is only to stop them
 * being invisible.
 */
const BASE = process.argv[2] ?? "https://yaame.dev";
const USER = process.argv[3] ?? "yaame";
const AS2 = "application/activity+json";
const LD = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

let failed = 0;
const fail = (what, detail) => {
  failed++;
  console.error(`  ✗ ${what}\n      ${detail}`);
};
const pass = (what) => console.log(`  ✓ ${what}`);
const note = (what, why) => console.log(`  · ${what}\n      ${why}`);

const get = async (url, accept) => {
  const res = await fetch(url, { headers: accept === null ? {} : { accept } });
  const type = res.headers.get("content-type") ?? "";
  let body = null;
  if (type.includes("json")) {
    try {
      body = await res.json();
    } catch {
      /* left null; the caller treats it as missing */
    }
  }
  return { status: res.status, type, body };
};

/**
 * Content negotiation.
 *
 * ActivityPub §3.2 makes AS2 for profiled `ld+json` a MUST and `activity+json`
 * only a SHOULD. A wildcard or absent Accept is outside the spec, but RFC 7231
 * §5.3.2 makes both mean "any representation will do", so 406 is wrong for them
 * — and a bare `curl` sends exactly that, which makes an endpoint holding the
 * document look broken.
 */
async function negotiation() {
  const url = `${BASE}/users/${USER}`;
  for (const [label, accept] of [
    ["application/ld+json; profile=… （规范 MUST）", LD],
    ["application/activity+json", AS2],
    ["*/*", "*/*"],
    ["无 Accept 头", null],
  ]) {
    const { status, type } = await get(url, accept);
    if (status === 200 && type.includes("json")) pass(`协商 ${label}`);
    else fail(`协商 ${label}`, `HTTP ${status}, content-type: ${type || "（无）"}`);
  }
}

/**
 * Every collection the actor advertises must answer.
 *
 * Mastodon decides whether a collection is private by whether it has a `first`:
 *
 *   has_first_page = collection['first'].present?
 *   hide_collections = following_private? || followers_private?
 *
 * Either one missing hides the whole follower list — the count still shows, the
 * list comes back empty. ActivityPub does not require paging, so this is an
 * interoperability requirement that cannot be read off the specification.
 */
async function collections(actor) {
  for (const key of ["outbox", "followers", "following", "featured"]) {
    const uri = actor[key];
    if (!uri) {
      fail(`actor 声明 ${key}`, "字段不存在；Mastodon 视作集合私有，列表会被隐藏");
      continue;
    }
    const { status, body } = await get(uri, AS2);
    if (status !== 200 || !body) {
      fail(`${key} 应答`, `HTTP ${status}`);
      continue;
    }
    if (typeof body.totalItems !== "number") {
      fail(`${key} 带 totalItems`, "缺少计数，多数客户端显示为 0");
    }
    // `first` is only required of followers and following, where its absence
    // reads as private. Other collections may inline their items, and
    // Mastodon's own featured does exactly that.
    const inline = body.orderedItems ?? body.items;
    if (!body.first) {
      if (["followers", "following"].includes(key)) {
        fail(`${key} 带 first`, "没有首页；Mastodon 据此判定集合私有并隐藏列表");
        continue;
      }
      if (!Array.isArray(inline)) {
        fail(`${key} 可取到条目`, "既没有 first，也没有内联的 items");
        continue;
      }
      pass(`${key}：totalItems=${body.totalItems}，内联 ${inline.length} 条`);
      continue;
    }
    const first = await get(String(body.first), AS2);
    if (first.status !== 200 || first.body?.type !== "OrderedCollectionPage") {
      fail(`${key} 的 first 页可取`, `HTTP ${first.status}, type: ${first.body?.type}`);
      continue;
    }

    // Without `next` a reader stops here: the collection claims N items and
    // offers no way to reach any beyond the first page.
    const shown = (first.body.orderedItems ?? first.body.items ?? []).length;
    if (shown < body.totalItems && !first.body.next) {
      fail(`${key} 分页可续`, `首页 ${shown} 条 / 共 ${body.totalItems} 条，但没有 next`);
      continue;
    }
    pass(`${key}：totalItems=${body.totalItems}，首页 ${shown} 条${first.body.next ? "，有 next" : ""}`);
  }
}

/**
 * The inbox only has to accept POST. Reading one is optional, so what is
 * asserted is that POST is not a 404 — that the route exists at all.
 */
async function inbox(actor) {
  const res = await fetch(actor.inbox, {
    method: "POST",
    headers: { "content-type": AS2 },
    body: "{}",
  });
  if (res.status === 404) fail("inbox 接收 POST", "404：路由不存在");
  else pass(`inbox 接收 POST（HTTP ${res.status}，非 404 即路由在）`);
}

/**
 * A discovery document must not point at something that is not there.
 *
 * A route without its dispatcher, or a dispatcher without its route, reports
 * nothing on either side: the link is advertised and answers 404.
 */
async function nodeinfo() {
  const { status, body } = await get(`${BASE}/.well-known/nodeinfo`, AS2);
  if (status !== 200 || !Array.isArray(body?.links) || body.links.length === 0) {
    fail("nodeinfo 发现文档", `HTTP ${status}，links: ${JSON.stringify(body?.links)}`);
    return;
  }
  for (const link of body.links) {
    const { status: s } = await get(link.href, "application/json");
    if (s === 200) pass(`nodeinfo → ${link.href}`);
    else fail(`nodeinfo → ${link.href}`, `HTTP ${s}`);
  }
}

/**
 * Fields a consumer reads, whose absence changes behaviour.
 *
 * Reported, never failed: these are decisions, not defects. Off is fine as long
 * as it was chosen rather than unnoticed.
 *
 * Behaviour taken from Mastodon's ProcessAccountService.
 */
const CHOICES = [
  ["discoverable", "缺席 ⇒ discoverable = false：账号不出现在目录与推荐里"],
  ["indexable", "缺席 ⇒ indexable = false：内容不进对方的全文检索"],
  ["published", "缺席 ⇒ 注册日期显示为对方首次见到我们的时间"],
  ["manuallyApprovesFollowers", "缺席 ⇒ locked = false：关注无需批准（多数情况正是想要的）"],
];

function choices(actor) {
  const absent = CHOICES.filter(([k]) => actor[k] === undefined);
  if (absent.length === 0) return;
  console.log("\n  以下字段缺席，对方会按默认值解释：");
  for (const [k, why] of absent) note(k, why);
}

const { status, body: actor } = await get(`${BASE}/users/${USER}`, AS2);
if (status !== 200 || !actor) {
  console.error(`  ✗ 取不到 actor：HTTP ${status}`);
  process.exit(1);
}

console.log(`  actor: ${actor.id}\n`);
await negotiation();
await collections(actor);
await inbox(actor);
await nodeinfo();
choices(actor);

console.log(failed === 0 ? "\n  ✓ 一致性检查通过" : `\n  ✗ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
