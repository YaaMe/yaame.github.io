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
  put(key: string, value: unknown): Promise<void>;

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
 * Drizzle rather than a hand-written layer: rendering CRUD into SQL, quoting
 * identifiers and spelling conflict clauses per dialect is solved work, and the
 * version here is one package with **no dependencies of its own** and a
 * provenance attestation — which is the part that matters when adding one.
 *
 * Typed as the shared async SQLite base so both drivers fit: D1 on Workers,
 * node:sqlite in a process. Swapping to Postgres later means Drizzle's postgres
 * driver and the same table definitions, not a second renderer written here.
 */
// Both parameters are left open, because the two drivers differ in both: D1 is
// SQLiteAsyncDatabase<'async', D1RunResult> and node:sqlite is <'sync',
// NodeSQLiteRunResult>. Pinning either would admit one driver and reject the
// other. What this application uses is the query builder above them, which is
// the same on both — and that is the part Drizzle guarantees.
// biome-ignore lint/suspicious/noExplicitAny: the two drivers differ only here
export type Database = SQLiteAsyncDatabase<any, any>;
