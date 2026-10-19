/**
 * Which posts go to the followers, and when one counts as handed over.
 *
 * Apart from outbox.ts, which reads astro:content: this takes the database and
 * the send it is given, so it runs and is tested without an Astro build.
 */
import type { Database } from "../../platform/types";
import type { Channel } from "../../lib/interactions/key-scheme.ts";
import { deliveryRow, enqueuedTargets, markEnqueued } from "./store/delivery-rows.ts";

export type Pending<T> = { target: string; activity: T };

type Failure = { target: string; error: unknown };

export type Outcome = {
  firstRun: boolean;
  sent: string[];
  /** The send threw; the post stays pending. */
  failed: Failure[];
  /** The stored schema refuses the post's mark, so it is never sent: nothing could stop it being sent again. */
  refused: string[];
  /** Sent, and its mark could not be written; held back from sending again. */
  unmarked: Failure[];
};

/**
 * Posts sent whose mark could not be written, keyed by channel and target.
 *
 * Without it, a mark that keeps failing re-sends its post to every follower on
 * every outbox request. Held for the life of the process: a new isolate or
 * process sends such a post once more, which receivers discard by the Create's
 * stable id.
 */
const sentUnmarked = new Set<string>();

/**
 * Send every post not yet enqueued, marking each only after its own send
 * resolved.
 *
 * Every mark is checked against the stored schema before anything is sent. A
 * send that throws leaves its post unmarked, so the next run sends it again;
 * the others still go. A mark that fails after a send resolved is retried on
 * later runs without sending again. Two runs at once can both send a post,
 * which receivers discard by the Create's stable id.
 *
 * A channel with no marks is on its first run. That run marks every post it
 * is given and sends none, so the archive does not arrive in one burst. A
 * channel with nothing published stays on its first run until something is,
 * and that first post is marked without being sent.
 */
export async function deliverPending<T>(
  db: Database,
  channel: Channel,
  items: Pending<T>[],
  send: (activity: T) => Promise<void>,
  heldBack: Set<string> = sentUnmarked,
): Promise<Outcome> {
  const outcome: Outcome = { firstRun: false, sent: [], failed: [], refused: [], unmarked: [] };
  const enqueuedAt = new Date().toISOString();
  const valid = items.flatMap(({ target, activity }) => {
    const row = deliveryRow(channel, target, enqueuedAt);
    if (row === null) outcome.refused.push(target);
    return row === null ? [] : [{ row, activity }];
  });

  const enqueued = await enqueuedTargets(db, channel);
  if (enqueued.size === 0) {
    await markEnqueued(db, valid.map(({ row }) => row));
    return { ...outcome, firstRun: true };
  }

  for (const { row, activity } of valid) {
    const key = JSON.stringify([channel, row.target]);
    if (enqueued.has(row.target)) {
      heldBack.delete(key);
      continue;
    }
    if (!heldBack.has(key)) {
      try {
        await send(activity);
      } catch (error) {
        outcome.failed.push({ target: row.target, error });
        continue;
      }
      outcome.sent.push(row.target);
    }
    try {
      await markEnqueued(db, [row]);
      heldBack.delete(key);
    } catch (error) {
      heldBack.add(key);
      outcome.unmarked.push({ target: row.target, error });
    }
  }
  return outcome;
}
