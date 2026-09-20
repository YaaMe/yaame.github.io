import type { KvStore, MessageQueue } from "@fedify/fedify";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async";

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
  /** Small JSON records of our own: the follower list. */
  get<T>(key: string): Promise<T | null>;
  /**
   * `ttl` is seconds, and is a request rather than a guarantee: a host that
   * can expire a key does, and one that cannot ignores it. Nothing may depend
   * on it — a record that must stop being valid carries its own expiry and is
   * checked when read.
   */
  put(key: string, value: unknown, opts?: { ttl?: number }): Promise<void>;
  remove(key: string): Promise<void>;

  /**
   * A database, or `false` where this host has none.
   *
   * Beside `kv` rather than under the feature that uses it: this is something a
   * host offers, like the queue, not something ActivityPub owns.
   */
  db: Database | false;

  /**
   * A value placed by hand, out of band — not written by this code, and not by
   * anything that deploys it.
   *
   * Separate from `get` because the two differ in who may write: records are
   * ours to change at runtime, secrets are not. Keeping them apart is what
   * stops a missing secret from being answered with a freshly minted one.
   */
  secret(name: string): string | undefined;
}

/**
 * A database handle.
 *
 * Typed as the shared async SQLite base so both drivers fit, with both
 * parameters left open because the two differ in both: D1 is
 * `SQLiteAsyncDatabase<'async', D1RunResult>`, node:sqlite is `<'sync',
 * NodeSQLiteRunResult>`. Pinning either admits one driver and rejects the
 * other. What this application uses is the query builder above them, which is
 * the same on both.
 *
 * See docs/decisions/0007-interactions-live-in-a-database-the-host-provides.md.
 */
// biome-ignore lint/suspicious/noExplicitAny: the two drivers differ only here
export type Database = SQLiteAsyncDatabase<any, any>;
