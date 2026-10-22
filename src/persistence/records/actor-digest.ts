import { actorDigest } from "../../config/data.config.generated.mjs";
import { recordAt } from "./record.ts";

export const record = recordAt<string>(actorDigest.key);
