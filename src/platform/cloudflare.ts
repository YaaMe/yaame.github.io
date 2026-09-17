import { env } from "cloudflare:workers";
import { MemoryKvStore } from "@fedify/fedify";
import type { Platform } from "./types";

/**
 * Cloudflare Workers.
 *
 * The only file allowed to import `cloudflare:workers` — a module that exists
 * in workerd and nowhere else, so a static import of it anywhere in the tree
 * would break the build on every other host.
 */
export const platform: Platform = {
  // Fedify's own store, in memory rather than in KV.
  //
  // It holds four things: cached remote documents, cached public keys, cached
  // signature specs, and a record of which activities have been processed. The
  // first three are caches — losing them costs a refetch. The fourth exists to
  // stop an activity being handled twice, and is only needed when handling it
  // twice would differ from handling it once.
  //
  // Today it would not: a repeated Follow replaces the same entry, a repeated
  // Undo filters an absent one. THIS STOPS BEING TRUE the moment a handler
  // accumulates rather than replaces — a reply appended to a list, a counter —
  // and idempotence has to move back to durable storage before that lands.
  //
  // The cost of memory is a lower hit rate: isolates are short-lived, so remote
  // documents are fetched more often. That is an outbound request instead of a
  // KV write, which is the trade being made on purpose.
  kv: new MemoryKvStore(),

  // No queue here yet. Cloudflare Queues would need the Worker to export a
  // queue() handler, and the adapter's entrypoint exports only fetch — so
  // turning this on is a change to the build, not to a line of configuration.
  queue: false,

  get: (key) => env.AP_KV.get(key, "json"),
  put: (key, value) => env.AP_KV.put(key, JSON.stringify(value)),
};
