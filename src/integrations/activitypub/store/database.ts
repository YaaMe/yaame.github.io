import { platform } from "../../../platform";
import type { Database } from "../../../platform/types";
import { migrate } from "./schema";

/**
 * The database, with its schema known to be current.
 *
 * Migrations run once per isolate rather than at deploy time, because a deploy
 * holds no database credentials of its own and both hosts would otherwise need
 * separate ways to reach the same tables. When there is nothing to do it costs
 * one read.
 */
let ready: Promise<Database> | null = null;

export function store(): Promise<Database> {
  if (ready) return ready;
  ready = (async () => {
    const db = platform.db;
    if (db === false) throw new Error("no database is bound");
    await migrate(db);
    return db;
  })();
  // A failed migration must not be remembered as done: a cached rejection would
  // make every later request fail with the first error, long after whatever
  // caused it had passed.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
