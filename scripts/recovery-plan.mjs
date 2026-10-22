import { RecoveryError } from "../src/services/recovery/errors.ts";
import { requireExisting } from "../src/services/recovery/plan.ts";

export async function runRecoveryAdapter({ exportFn, importFn }) {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const input = JSON.parse(text);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RecoveryError("INVALID_RECOVERY_RECORDS", "recovery input must be a JSON object");
  }
  requireExisting(input.existing);
  const exporting = process.argv.includes("--export");
  const importing = process.argv.includes("--import");
  if (exporting === importing) throw new Error("recovery adapter needs exactly one of --export or --import");
  if (importing && !Object.hasOwn(input, "document")) {
    throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", "recovery import requires a document");
  }
  const result = await (exporting ? exportFn(input) : importFn(input));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export async function runRecoveryReader({ label, snapshot, prepare, apply }) {
  const argv = process.argv.slice(2);
  const modes = ["--snapshot", "--validate-plan", "--apply-plan"].filter((mode) => argv.includes(mode));
  if (modes.length !== 1) {
    throw new Error(`${label} needs exactly one of --snapshot, --validate-plan or --apply-plan`);
  }
  let result;
  if (modes[0] === "--snapshot") {
    result = await snapshot(argv.includes("--import"));
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const plan = await prepare(JSON.parse(text));
    if (modes[0] === "--apply-plan") {
      await apply(plan);
      result = { ...plan, applied: true };
    } else {
      result = plan;
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
