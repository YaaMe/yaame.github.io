/**
 * Followers against a given database: the only file that queries the
 * followers table.
 *
 * Every write is one statement on its own rows. A list read, changed and
 * written back loses whichever of two concurrent writers finishes first.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../platform/types";
import { type Source, identityId } from "../../../lib/interactions/key-scheme.ts";
import { storedFollowerSchema, visitorIdentitySchema } from "../../../lib/interactions/records.ts";
import { followers as followersLocation, visitorIdentities as identitiesLocation } from "../../../data.config.generated.mjs";
import { followers } from "./schema.ts";
import { sqlValue } from "./sql-text.ts";
import { queryBatches } from "./query-batches.ts";

export type Follower = { identifier: string; inbox: string | null; sharedInbox: string | null };

/**
 * Record a follower, or refresh one already held.
 *
 * A repeat follow is how a moved inbox reaches us, so it replaces the
 * addresses and the activity id; when the follower first followed stays.
 * False when the stored inputs are refused.
 *
 * The identity and the follower are one atomic write, so a failure leaves
 * neither behind.
 */
export async function upsertFollower(db: Database, value: unknown): Promise<boolean> {
  const follower = storedFollowerSchema.safeParse(value);
  if (!follower.success) return false;
  const identity = visitorIdentitySchema.safeParse({
    id: follower.data.id,
    source: follower.data.source,
    identifier: follower.data.identifier,
    name: null,
  });
  if (!identity.success) return false;
  const insert = (location: { table: string; columns: Record<string, string>; quotedColumns: Record<string, string> }, row: Record<string, string | null>) =>
    `INSERT INTO ${location.table} (${Object.values(location.quotedColumns).join(", ")}) VALUES (${
      Object.keys(location.columns).map((column) => sqlValue(row[column] ?? null)).join(", ")}) ON CONFLICT (${location.quotedColumns.id})`;
  const refreshed = (["inbox", "sharedInbox", "followId"] as const)
    .map((column) => `${followersLocation.quotedColumns[column]} = excluded.${followersLocation.quotedColumns[column]}`);
  await db.atomic([
    `${insert(identitiesLocation, identity.data)} DO NOTHING`,
    `${insert(followersLocation, follower.data)} DO UPDATE SET ${refreshed.join(", ")}`,
  ]);
  return true;
}

/** Remove the row the identity names; no one else's unfollow reaches it. */
export async function removeFollower(db: Database, source: Source, identifier: string): Promise<boolean> {
  let id: string;
  try {
    id = identityId(source, identifier);
  } catch {
    return false;
  }
  const removed = await db.delete(followers).where(eq(followers.id, id)).returning({ id: followers.id });
  return removed.length > 0;
}

/**
 * Remove the named followers whose personal inbox is the one written off.
 *
 * By id, not by inbox alone: an inbox is a string a follower publishes about
 * itself, so another row can carry the same one. The inbox still has to match,
 * so a follower who has since moved inboxes is kept. Returns the identifiers
 * removed.
 */
export async function removeFollowersAtInbox(
  db: Database,
  source: Source,
  identifiers: readonly string[],
  inbox: string,
): Promise<string[]> {
  const ids = identifiers.flatMap((identifier) => {
    try {
      return [identityId(source, identifier)];
    } catch {
      return [];
    }
  });
  const removed: string[] = [];
  // The source and the inbox are bound beside the ids.
  for (const batch of queryBatches(ids, 2)) {
    const rows = await db.delete(followers)
      .where(and(eq(followers.source, source), eq(followers.inbox, inbox), inArray(followers.id, batch)))
      .returning({ identifier: followers.identifier });
    removed.push(...rows.map(({ identifier }) => identifier));
  }
  return removed;
}

/** One source's followers, newest first; the id breaks ties so paging sees one fixed order. */
export async function listFollowers(db: Database, source: Source): Promise<Follower[]> {
  return db
    .select({ identifier: followers.identifier, inbox: followers.inbox, sharedInbox: followers.sharedInbox })
    .from(followers)
    .where(eq(followers.source, source))
    .orderBy(desc(followers.followedAt), desc(followers.id));
}
