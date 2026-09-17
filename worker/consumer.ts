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
import { federation } from "../src/integrations/activitypub/federation";
import { platform } from "virtual:platform";

export default {
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

    for (const message of batch.messages) {
      try {
        const result = await queue.processMessage(message.body);

        // An ordering-key lock is still held by another message, so this one is
        // not ready. Retrying is the only correct answer: acking would drop it.
        if (!result.shouldProcess) {
          message.retry();
          continue;
        }

        await federation.processQueuedTask(undefined, result.message);
        message.ack();
      } catch (error) {
        // Let the queue retry with backoff. Acking here would turn a failed
        // delivery into a silent one, which is what the queue exists to avoid.
        console.error("delivery failed", error);
        message.retry();
      }
    }
  },
};
