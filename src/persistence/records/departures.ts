import { departures } from "../../config/data.config.generated.mjs";
import { recordAt } from "./record.ts";
import type { Departure } from "../../models/records/departures.ts";

const record = recordAt<Departure[]>(departures.key);
const KEEP = 50;

export async function prepend(entry: () => Departure): Promise<void> {
  const seen = (await record.get()) ?? [];
  await record.put([entry(), ...seen].slice(0, KEEP));
}
