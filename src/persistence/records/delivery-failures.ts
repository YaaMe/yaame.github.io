import { deliveryFailures } from "../../config/data.config.generated.mjs";
import type { DeliveryFailure, ExhaustedDelivery } from "../../models/records/delivery-failures.ts";
import { recordAt } from "./record.ts";

/**
 * Written-off deliveries, keyed by inbox.
 *
 * A set rather than a log: what is worth keeping is which inboxes are dead, not
 * how many times each one failed. Keying by inbox means a host that fails
 * repeatedly occupies one entry, and the record stays the size of the problem.
 */
const record = recordAt<Record<string, DeliveryFailure>>(deliveryFailures.key);

export async function recordFailure(what: ExhaustedDelivery): Promise<void> {
  const set = (await record.get()) ?? {};
  set[what.inbox ?? "(unknown)"] = { at: new Date().toISOString(), ...what };
  await record.put(set);
}
