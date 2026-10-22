import { following } from "../../config/data.config.generated.mjs";
import { recordAt } from "./record.ts";

export const record = recordAt<string[]>(following.key);
