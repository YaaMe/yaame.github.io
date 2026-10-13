import { RecoveryError, importRecovery } from "../src/lib/recovery.ts";

function requireExisting(existing) {
  if (typeof existing !== "boolean") {
    throw new RecoveryError("INVALID_RECOVERY_RECORDS", "recovery input existing must be a boolean");
  }
}

export async function planRecoveryImport({ register, document, kind, facility, existing, existingReason }) {
  requireExisting(existing);
  if (existing) {
    throw new RecoveryError("RECOVERY_IMPORT_FAILED", `cannot import into a non-empty store${existingReason ? `: ${existingReason}` : ""}`);
  }
  const writes = [];
  const result = await importRecovery({
    register,
    document,
    facilities: {
      [kind]: {
        async import(request) {
          writes.push(...await facility(request));
        },
      },
    },
  });
  return { ...result, writes };
}

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
    result = modes[0] === "--apply-plan" ? await apply(plan) : plan;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
