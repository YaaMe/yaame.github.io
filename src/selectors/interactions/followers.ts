import { SOURCES } from "../../lib/interactions/key-scheme.ts";
import { store } from "../../integrations/activitypub/store/database.ts";
import { listFollowers } from "../../integrations/activitypub/store/follower-rows.ts";

export type FederatedFollower = { identifier: string; inbox: string; sharedInbox: string | null };

/** Every federated row carries an inbox; the stored schema refuses one without. */
export async function all(): Promise<FederatedFollower[]> {
  return (await listFollowers(await store(), SOURCES.activitypub))
    .flatMap(({ inbox, ...rest }) => (inbox === null ? [] : [{ ...rest, inbox }]));
}
