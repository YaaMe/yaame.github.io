import { federation } from "../../gateways/activitypub/runtime.ts";
import { deliveryFailureRow, type FailureReason } from "../../models/interactions/failures.ts";
import { store } from "../../persistence/interactions/database.ts";
import { upsertFailure } from "../../persistence/interactions/failure-rows.ts";

export const deliverQueuedTask = (message: Parameters<typeof federation.processQueuedTask>[1]) =>
  federation.processQueuedTask(undefined, message);

/**
 * Records a written-off delivery. Resolves only once the row is written; the
 * caller prunes and acknowledges after that, so a refused write leaves the
 * message to be retried.
 */
export async function recordExhaustedFailure(
  what: { inbox?: unknown; activity?: unknown },
  { reason, attempt }: { reason: FailureReason; attempt: number },
): Promise<void> {
  await upsertFailure(await store(), deliveryFailureRow({
    inbox: what.inbox, activityId: what.activity, attempt, reason, at: new Date(),
  }));
}
