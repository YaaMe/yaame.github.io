import { prepend } from "../../persistence/records/departures.ts";
import type { Departure } from "../../models/records/departures.ts";

export async function recordDeparture(id: string, reason: Departure["reason"], detail?: string): Promise<void> {
  await prepend(() => ({ id, reason, at: new Date().toISOString(), ...(detail ? { detail } : {}) }));
}
