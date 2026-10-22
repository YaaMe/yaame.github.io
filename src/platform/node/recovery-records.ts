import { recordFile } from "./records.ts";
import { recordLayerDescriptors } from "../../services/recovery/records.ts";
import type { RecordPlan } from "../../services/recovery/records.ts";
import type { RecoveryRegister } from "../../services/recovery/index.ts";
export { recordFile } from "./records.ts";

function throwError(message: string): never {
  throw new Error(message);
}

export function nodeRecordDescriptors(register: RecoveryRegister) {
  return recordLayerDescriptors(register, { allowRecordKeyPatterns: false });
}

export function validateRecordPlan(dataDir: string, plan: RecordPlan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.writes)) {
    throwError("recovery write plan is malformed");
  }
  const keys = new Set();
  for (const [index, write] of plan.writes.entries()) {
    if (!write || write.action !== "write" || typeof write.key !== "string" || !Object.hasOwn(write, "value")) {
      throwError("recovery write plan item " + index + " is not a keyed write");
    }
    const path = recordFile(dataDir, write.key);
    if (keys.has(path)) throwError("recovery write plan contains the same physical file twice: " + path);
    keys.add(path);
  }
  return plan;
}
