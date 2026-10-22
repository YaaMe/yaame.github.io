import { federation } from "../../gateways/activitypub/runtime.ts";

export { recordFailure as recordExhaustedFailure } from "../../persistence/records/delivery-failures.ts";

export const deliverQueuedTask = (message: Parameters<typeof federation.processQueuedTask>[1]) =>
  federation.processQueuedTask(undefined, message);
