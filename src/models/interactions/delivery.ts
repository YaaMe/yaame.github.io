import { type Channel, deliveryId } from "./key-scheme.ts";
import { storedDeliverySchema } from "./records.ts";
import { parseStoredRow } from "./stored-row.ts";

export type Delivery = { id: string; channel: Channel; target: string; enqueuedAt: string };

/** The row a mark would write, or null when the stored schema refuses it. */
export function deliveryRow(channel: Channel, target: string, enqueuedAt: string): Delivery | null {
  let id: string;
  try {
    id = deliveryId(channel, target);
  } catch {
    return null;
  }
  return parseStoredRow(storedDeliverySchema, { id, channel, target, enqueuedAt }) as Delivery | null;
}
