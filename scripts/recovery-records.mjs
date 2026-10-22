import registerData from "../src/config/data.config.json" with { type: "json" };
import { registerForLayerKinds } from "../src/services/recovery/index.ts";
import { exportRecordRecovery, importRecordRecovery } from "../src/services/recovery/records.ts";
import { runRecoveryAdapter } from "./recovery-plan.mjs";
import { runIfMain } from "./run-cli.mjs";

async function cli() {
  const register = registerForLayerKinds(registerData, ["records"]);
  return runRecoveryAdapter({
    exportFn: (input) => exportRecordRecovery({ register, snapshot: input.records }),
    importFn: (input) => importRecordRecovery({
      register,
      document: input.document,
      snapshot: input.records,
      existing: input.existing,
      existingReason: input.existingReason,
    }),
  });
}

await runIfMain(import.meta.url, cli);
