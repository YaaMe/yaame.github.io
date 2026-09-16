import { env } from "cloudflare:workers";
import { WorkersKvStore } from "@fedify/cfworkers";
import type { Platform } from "./types";

/**
 * Cloudflare Workers.
 *
 * The only file allowed to import `cloudflare:workers` — a module that exists
 * in workerd and nowhere else, so a static import of it anywhere in the tree
 * would break the build on every other host.
 */
export const platform: Platform = {
  kv: new WorkersKvStore(env.AP_KV),

  get: (key) => env.AP_KV.get(key, "json"),
  put: (key, value) => env.AP_KV.put(key, JSON.stringify(value)),
};
