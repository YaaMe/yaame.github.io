/**
 * Cursor paging for the collections.
 *
 * ActivityPub leaves page size to the implementer and only advises capping it
 * (§B.9) so a client is not handed an unbounded document.
 *
 * The cursor is an offset into a list rebuilt on every request. An item
 * inserted while a reader is paging shifts everything after it, so the reader
 * can see one item twice or miss one.
 */
export const PAGE_SIZE = 20;

/** The cursor of the first page. Everything starts at offset zero. */
export const FIRST = () => "0";

export function parseCursor(cursor: string | null): number {
  // Invalid cursors start at the beginning, including stale or hand-typed URLs.
  const offset = Number.parseInt(cursor ?? "0", 10);
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}
