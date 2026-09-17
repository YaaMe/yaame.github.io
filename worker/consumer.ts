/**
 * The delivery queue's consumer.
 *
 * A Worker of its own, because @astrojs/cloudflare strips `queues.consumers`
 * from the configuration it generates — the site's Worker can enqueue and
 * cannot consume. Splitting them is what that design decision asks for, and it
 * has its own upside: this can be restarted, read and fail on its own without
 * touching the site.
 *
 * It imports the same federation as the site, so the actor, its keys and the
 * follower list are one definition rather than two that could drift. The
 * outbox is deliberately not imported: it reads the posts through
 * astro:content, which exists only inside an Astro build.
 */
import type { WorkersMessageQueue } from "@fedify/cfworkers";
import { announceActorChange, federation } from "../src/integrations/activitypub/federation";
import { platform } from "virtual:platform";

/**
 * The retry curve, and where it stops.
 *
 * The first three retries are quick — 5s, 15s, 45s — because most failures are
 * a blip and waiting out a blip is wasted time. After that the gaps widen to
 * 5, 15 and 40 minutes, waiting out an outage instead. They sum to a little
 * over an hour, and the attempt that follows is written off rather than
 * retried: a follower's server that is simply unreachable
 * fails the same way forever, and two Accepts aimed at a follow the user had
 * already cancelled were still being redelivered two and a half hours later,
 * spending queue operations on an outcome that could not change.
 *
 * The queue's own max_retries is set above this so that this is the ceiling
 * that applies — the other one would cut the curve short without recording
 * anything.
 */
const BACKOFF = [5, 15, 45, 300, 900, 2400];
const MAX_ATTEMPTS = BACKOFF.length + 1;
const backoff = (attempts: number) => BACKOFF[Math.min(attempts, BACKOFF.length) - 1];

/**
 * Written-off deliveries, keyed by inbox.
 *
 * A set rather than a log: what is worth keeping is which inboxes are dead, not
 * how many times each one failed. Keying by inbox means a host that fails
 * repeatedly occupies one entry, and the record stays the size of the problem.
 */
const FAILURES = "ap:delivery-failures";

export default {
  /**
   * The actor's own changes, announced.
   *
   * On a timer rather than at deploy time because the deploy has no key — by
   * design — and signing is what this needs. The work is a fingerprint
   * comparison, so a tick that finds nothing changed costs one KV read.
   */
  async scheduled() {
    console.log("actor announce:", await announceActorChange());
  },

  async queue(batch: MessageBatch) {
    // The platform's queue, not one constructed here: the site enqueues through
    // that object, and a second construction would keep working against the old
    // binding after the first one changed.
    //
    // `false` means this Worker was deployed without the binding — worth
    // failing on, since the alternative is a consumer that runs and processes
    // nothing.
    if (platform.queue === false) {
      throw new Error("queue consumer deployed without a queue binding");
    }
    // processMessage is specific to the Workers queue and not part of the
    // MessageQueue interface the platform advertises.
    const queue = platform.queue as WorkersMessageQueue;

    // Which activity, not only what became of it. Recording the outcome alone
    // made two Accepts — one for a follow since cancelled, one for the live
    // request — indistinguishable, and a success belonging to the first was
    // read as success for the second.
    const describe = (m: unknown) => {
      const msg = m as { type?: string; inbox?: string; activity?: Record<string, unknown> };
      const object = msg.activity?.object as { id?: string } | string | undefined;
      return {
        type: msg.type,
        inbox: msg.inbox,
        activity: msg.activity?.id,
        object: typeof object === "string" ? object : object?.id,
      };
    };

    const writeOff = async (
      what: { inbox?: string; reason: string; attempts: number; [key: string]: unknown },
    ) => {
      const set = (await platform.get<Record<string, unknown>>(FAILURES)) ?? {};
      set[what.inbox ?? "(unknown)"] = { at: new Date().toISOString(), ...what };
      await platform.put(FAILURES, set);
    };

    for (const message of batch.messages) {
      // Hoisted so the failure paths can name the activity even when the throw
      // came from processMessage, before there was a result to describe.
      let what = describe(message.body);
      try {
        const result = await queue.processMessage(message.body);
        what = describe(result.message);

        // An ordering-key lock is still held by another message, so this one is
        // not ready. Retrying is the only correct answer: acking would drop it.
        if (!result.shouldProcess) {
          // Not an exception, so nothing would report it on its own — and a
          // message that is never ready would otherwise be retried until the
          // queue drops it without a word.
          console.warn("not ready", what);
          if (message.attempts < MAX_ATTEMPTS) {
            message.retry({ delaySeconds: backoff(message.attempts) });
            continue;
          }
          await writeOff({ ...what, reason: "never ready", attempts: message.attempts });
          message.ack();
          continue;
        }

        await federation.processQueuedTask(undefined, result.message);
        console.log("delivered", what);
        message.ack();
      } catch (error) {
        // Retrying is right up to a point, and acking before it would turn a
        // failed delivery into a silent one — which is what the queue exists to
        // avoid. Past the ceiling the reverse is true: the failure is settled,
        // and continuing to retry is what makes it silent, because nothing ever
        // reaches a state anyone could look at.
        console.error("delivery failed", error);
        if (message.attempts < MAX_ATTEMPTS) {
          message.retry({ delaySeconds: backoff(message.attempts) });
          continue;
        }

        await writeOff({ ...what, reason: String(error), attempts: message.attempts });
        console.error("giving up after", message.attempts, "attempts", what);
        message.ack();
      }
    }
  },
};
