import type { KvStore, MessageQueue } from "@fedify/fedify";

/** What the rest of the tree may assume about wherever this is running. */
export interface Platform {
  /** Fedify's own store — cache, keys, delivery bookkeeping. */
  kv: KvStore;

  /**
   * A queue, or `false` where this host has none.
   *
   * `false` rather than absent, so every platform answers the same question and
   * a missing implementation cannot pass for a host that has nothing to offer.
   * And a plain `false` rather than a queue that accepts and discards: without
   * one, delivery is synchronous and a failure is reported: with a silent
   * stand-in it would be lost instead.
   */
  queue: MessageQueue | false;
  /** Small JSON records of our own: the actor key, the follower list. */
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
}
