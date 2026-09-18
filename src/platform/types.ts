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
  /** Small JSON records of our own: the follower list. */
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;

  /**
   * A SQL store, or `false` where this host has none.
   *
   * `false` for the same reason the queue has it: every platform answers the
   * same question, and a missing implementation cannot pass for a host that has
   * nothing to offer. The static profile builds no Worker at all, so nothing
   * there binds a database.
   */
  sql: SqlStore | false;

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
 * What every host must be able to answer with.
 *
 * SQLite dialect on both sides — D1 on Workers, node:sqlite in a process — so
 * the statements are written once and run in both. The interface is async
 * because D1 is; the node implementation resolves immediately.
 *
 * Deliberately four methods and no query builder. The work here is appending a
 * row, reading a few back by one or two keys, and incrementing a counter; a
 * builder would be a layer between us and statements we can already read.
 */
/**
 * Narrower than either implementation accepts, on purpose.
 *
 * Blobs are left out because nothing here stores one, and the two sides spell
 * them differently — D1 takes an ArrayBuffer, node:sqlite a Uint8Array. Adding
 * a conversion for a capability no caller wants would be a layer maintained
 * against a hypothetical.
 */
export type SqlValue = string | number | null;

export interface SqlStore {
  /** Every row the statement selects, in the order it returns them. */
  all<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;

  /** The first row, or null when there is none. */
  first<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;

  /** A write. Returns the number of rows it changed. */
  run(sql: string, ...params: SqlValue[]): Promise<number>;

  /**
   * Several writes, applied together or not at all.
   *
   * Needed wherever a record and its index entry have to move as one — a
   * partially applied write is the failure mode that leaves a comment whose
   * thread does not know about it.
   */
  batch(statements: { sql: string; params: SqlValue[] }[]): Promise<void>;
}
