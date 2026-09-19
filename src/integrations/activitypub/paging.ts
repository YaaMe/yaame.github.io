/**
 * Cursor paging for the collections.
 *
 * ActivityPub leaves page size to the implementer and only advises capping it
 * (§B.9) so a client is not handed an unbounded document.
 *
 * The cursor is an offset. That is the simplest thing that works over a list
 * computed from git, and it has the failure mode offsets always have: an item
 * inserted while a reader is paging shifts everything after it, so the reader
 * can see one item twice or miss one. For an archive that grows at one end and
 * a reader that pages in seconds, that is a smaller cost than carrying a
 * sort-key cursor through a collection with no stable key of its own.
 */
export const PAGE_SIZE = 20;

/** The cursor of the first page. Everything starts at offset zero. */
export const FIRST = () => "0";

export function page<T>(items: T[], cursor: string | null): { items: T[]; nextCursor: string | null } {
  // A dispatcher is only called with a cursor once paging is on, but a bad one
  // can arrive from anywhere — a stale link, a hand-typed URL. Anything that is
  // not a number starts at the beginning rather than throwing.
  const offset = Number.parseInt(cursor ?? "0", 10);
  const from = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const slice = items.slice(from, from + PAGE_SIZE);
  const next = from + PAGE_SIZE;
  return { items: slice, nextCursor: next < items.length ? String(next) : null };
}
