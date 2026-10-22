import { followLedger } from "../../config/data.config.generated.mjs";
import { recordAt } from "./record.ts";

export const record = recordAt<Record<string, string>>(followLedger.key);
