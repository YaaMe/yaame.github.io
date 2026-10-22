import { exportSqlRecovery, importSqlRecovery, sqlRecoveryRegister } from "../src/services/recovery/sql.ts";
import { runRecoveryAdapter } from "./recovery-plan.mjs";
import { runIfMain } from "./run-cli.mjs";

async function cli() {
  const register = sqlRecoveryRegister();
  return runRecoveryAdapter({
    exportFn: (input) => exportSqlRecovery({ register, snapshot: input.sql }),
    importFn: (input) => importSqlRecovery({ register, document: input.document, existing: input.existing }),
  });
}

await runIfMain(import.meta.url, cli);
