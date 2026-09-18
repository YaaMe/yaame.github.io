#!/usr/bin/env node
/**
 * 对着**正在服务的** ActivityPub 端点做一致性检查。
 *
 * 存在的理由:今天修掉的每一个缺陷都是同一个形状 —— 我们发出的文档里少了
 * 某样东西,而少了什么在我们自己的输出里不可见。检视自己的响应永远看不出
 * 遗漏,只有拿外部参照对照才能。参照一直是临时去找的,于是每次都要等一次
 * 用户报告。
 *
 * 这份脚本把那份参照写死下来:消费方读什么、缺了会发生什么。它检查的不是
 * "我写的东西按我写的那样跑了吗",而是"对面拿到的东西够不够用"。
 *
 *   node scripts/ap-check.mjs [base-url]
 *
 * 失败退出非零。选择类的缺席只报告不失败 —— 它们是人该决定的事,脚本的职责
 * 是不让它们保持隐形。
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
      /* 留作 null，调用方按缺失处理 */
    }
  }
  return { status: res.status, type, body };
};

/**
 * 内容协商。
 *
 * AP §3.2 规定服务端 MUST 对带 profile 的 ld+json 返回 AS2;activity+json
 * 只是 SHOULD。通配的 Accept 与缺省 Accept 不在规范里，但 RFC 7231 §5.3.2 说它们
 * 表示"任何表示都可接受",对它们回 406 是错的 —— 而裸 curl 正是这么发的,
 * 于是一个手里有文档的端点看起来像坏了。
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
 * actor 声明的每一个集合都必须应答,而且必须带 first。
 *
 * Mastodon 的 ProcessAccountService 用 first 的有无判定集合是否私有:
 *
 *   has_first_page = collection['first'].present?
 *   hide_collections = following_private? || followers_private?
 *
 * 两个集合里任意一个没有 first,对方就把整份关注者列表藏起来 —— 计数照常
 * 显示,列表返回空数组。AP 本身不要求分页,所以这条是纯粹的互操作要求,
 * 从规范上读不出来。
 */
async function collections(actor) {
  for (const key of ["outbox", "followers", "following"]) {
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
    if (!body.first) {
      fail(`${key} 带 first`, "没有首页；Mastodon 据此判定集合私有并隐藏列表");
      continue;
    }
    const first = await get(String(body.first), AS2);
    if (first.status !== 200 || first.body?.type !== "OrderedCollectionPage") {
      fail(`${key} 的 first 页可取`, `HTTP ${first.status}, type: ${first.body?.type}`);
      continue;
    }

    // 一页装不下时必须给 next，否则读者走到这里就断了 —— 集合声称有 N 条，
    // 却没有办法取到第一页之外的任何一条。
    const shown = (first.body.orderedItems ?? first.body.items ?? []).length;
    if (shown < body.totalItems && !first.body.next) {
      fail(`${key} 分页可续`, `首页 ${shown} 条 / 共 ${body.totalItems} 条，但没有 next`);
      continue;
    }
    pass(`${key}：totalItems=${body.totalItems}，首页 ${shown} 条${first.body.next ? "，有 next" : ""}`);
  }
}

/**
 * inbox 只需要接收 POST。读取是可选的,所以这里不要求 GET 成功 —— 要求的是
 * POST 不是 404,即路由确实存在。
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
 * 发现文档不能指向不存在的东西。
 *
 * 这里曾经返回 {"links": []} —— 一份什么也没发现的发现文档,而它本该指向的
 * 那条路由 404。路由有、调度器没有,两边都不报错。
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
 * 消费方会读、而缺席会改变行为的字段。
 *
 * 不失败:这些是人该做的决定,不是 bug。脚本的职责只是不让"默认关"保持隐形
 * —— 关着可以，但要是你选的，不是因为没人注意到。
 *
 * 行为取自 mastodon/app/services/activitypub/process_account_service.rb。
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
