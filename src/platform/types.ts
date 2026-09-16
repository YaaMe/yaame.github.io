import type { KvStore } from "@fedify/fedify";

/** What the rest of the tree may assume about wherever this is running. */
export interface Platform {
  /** Fedify's own store — cache, keys, delivery bookkeeping. */
  kv: KvStore;
  /** Small JSON records of our own: the actor key, the follower list. */
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
}
