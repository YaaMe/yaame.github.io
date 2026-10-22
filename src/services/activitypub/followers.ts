import * as followerRows from "../interactions/followers.ts";
import { recordDeparture } from "../../signals/activitypub/departures.ts";

/**
 * Drop the followers a written-off delivery was for (ActivityPub §7.5).
 *
 * Without this the follower stays on the list and every later publish spends
 * another hour of retries on the same dead address.
 *
 * Only the actors the delivery named, and only where that inbox is their
 * personal one. Another row carrying the same inbox string is not touched:
 * an inbox is something a follower says about itself. A shared inbox stands
 * for everyone on that host, so one failed delivery to it is not evidence
 * about any particular follower — pruning on it would turn a remote outage
 * into a silent loss of the audience.
 */
export async function dropFollowersAt(inbox: string, actorIds: readonly string[], reason?: string): Promise<string[]> {
  const gone = await followerRows.dropAtInbox(actorIds, inbox);
  for (const actorUrl of gone) await recordDeparture(actorUrl, "unreachable", reason);
  return gone;
}
