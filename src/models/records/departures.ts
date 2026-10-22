/**
 * Why a follower is no longer on the list.
 *
 * A removal otherwise leaves only a log line, and a log expires. "The follower
 * count dropped" then has three answers — written off, account deleted,
 * unfollowed — and no way to tell which, which is exactly the question that
 * gets asked and cannot be answered.
 *
 * Capped, because this grows without anything trimming it and only the recent
 * entries answer anything. Read-modify-write on a KV key is not atomic and two
 * departures in the same instant can lose one; a lost diagnostic costs less
 * than the lost follower it describes, which is why followers are rows and
 * this is not.
 */
export type Departure = { id: string; reason: "unreachable" | "deleted" | "unfollowed"; at: string; detail?: string };
