import { env } from "cloudflare:workers";
import { MemoryKvStore } from "@fedify/fedify";
import { WorkersMessageQueue } from "@fedify/cfworkers";
import { drizzle } from "drizzle-orm/d1";
import type { Platform } from "./types";

/**
 * Cloudflare Workers.
 *
 * The only file allowed to import `cloudflare:workers` — a module that exists
 * in workerd and nowhere else. It is never in the module graph on another host,
 * because DEPLOY_TARGET picks which of these files `virtual:platform` resolves
 * to before the build.
 *
 * Assembled a piece at a time rather than as one literal, and each binding is
 * read through a getter rather than at module load. Both for the same reason:
 * a binding that is not there yet reads as absent, and an absent queue is
 * indistinguishable from a deployment that has none — the queue would appear
 * wired and never be used, with nothing to say so.
 */
const platform = {} as Platform;

// Fedify's own store. Three of the four things it holds are caches; the fourth
// stops an activity being handled twice, which today differs from handling it
// once in no way — a repeated Follow replaces the same entry, a repeated Undo
// filters an absent one. THAT STOPS BEING TRUE the moment a handler accumulates
// rather than replaces, and idempotence has to become durable before it does.
platform.kv = new MemoryKvStore();

Object.defineProperty(platform, "queue", {
  enumerable: true,
  get(): Platform["queue"] {
    const e = env as { AP_QUEUE?: Queue; AP_KV: KVNamespace };
    if (!e.AP_QUEUE) return false;

    // orderingKv is what makes ordering keys work at all: without it
    // processMessage can report a message as not ready, and a message that is
    // never ready is retried to the limit and then dropped.
    return new WorkersMessageQueue(e.AP_QUEUE, { orderingKv: e.AP_KV });
  },
});

// Small durable records of our own: the actor's key, the follower list.
// Secrets arrive on the same `env` as the other bindings; what differs is that
// the value is in no file here and cannot be read back out of Cloudflare. The
// name is declared in the wrangler config, which is what puts it on `Env`.
//
// Looked up by name rather than read as a property, so the checked type is the
// one thing left to establish: `env` also holds namespaces and queues, and a
// mistyped name would otherwise hand one of those back as a key.
// D1 speaks SQLite, so the table definitions are shared with the node build
// rather than written twice. `false` when the binding is absent: the static
// profile builds no Worker, and nothing there has a database.
Object.defineProperty(platform, "db", {
  enumerable: true,
  get(): Platform["db"] {
    const d1 = (env as { AP_DB?: D1Database }).AP_DB;
    return d1 ? drizzle(d1) : false;
  },
});

platform.secret = (name) => {
  const value: unknown = Reflect.get(env as object, name);
  return typeof value === "string" ? value : undefined;
};

platform.get = (key) => (env as { AP_KV: KVNamespace }).AP_KV.get(key, "json");
platform.put = (key, value) =>
  (env as { AP_KV: KVNamespace }).AP_KV.put(key, JSON.stringify(value));

export { platform };
