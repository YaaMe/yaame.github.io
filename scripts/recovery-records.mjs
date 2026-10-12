/**
 * Host-free recovery adapter for a keyed JSON record store.
 *
 * The node entry point supplies one JSON snapshot and receives one JSON write
 * plan. File names, directories and the transaction that applies the plan
 * belong to the node side; this module only applies the recovery contract to
 * logical register records.
 */

import registerData from "../src/data.config.json" with { type: "json" };
import {
  RecoveryError,
  exportRecovery,
  importRecovery,
  isRecordKeyPattern,
  registerForLayerKinds,
  selectRecovery,
} from "../src/lib/recovery.ts";

function keyMatches(declaration, key) {
  if (!isRecordKeyPattern(declaration)) return declaration === key;
  const expression = declaration
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[A-Za-z][A-Za-z0-9_]*\\\}/gu, ".+?");
  return new RegExp(`^${expression}$`, "u").test(key);
}

/** Describe the concrete records that a facility can enumerate. */
export function recordLayerDescriptors(register, { allowRecordKeyPatterns = true } = {}) {
  const descriptors = [];
  const selected = registerForLayerKinds(register, ["records"]);
  for (const { kind, entry } of selectRecovery(selected).keep) {
    for (const [layer, value] of entry.layers.entries()) {
      if (!Object.hasOwn(value, "records")) continue;
      if (typeof value.records !== "string") {
        throw new RecoveryError(
          "RECOVERY_EXPORT_FAILED",
          `${kind}[${layer}] is not a keyed records layer`,
        );
      }
      if (!allowRecordKeyPatterns && isRecordKeyPattern(value.records)) {
        throw new RecoveryError(
          "RECOVERY_EXPORT_FAILED",
          `${kind}[${layer}] uses a record key pattern; this node store cannot enumerate it`,
        );
      }
      descriptors.push({ kind, layer, key: value.records });
    }
  }
  return descriptors;
}

function snapshotKey(item) {
  return `${item.kind}\u0000${item.layer}`;
}

function validateSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) {
    throw new RecoveryError("INVALID_RECOVERY_RECORDS", "node records snapshot must be an array");
  }
  const seen = new Set();
  for (const [index, item] of snapshot.entries()) {
    if (!item || typeof item !== "object" || typeof item.kind !== "string"
      || !Number.isInteger(item.layer) || item.layer < 0 || typeof item.present !== "boolean") {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `node records snapshot item ${index} is malformed`);
    }
    if (typeof item.key !== "string") {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `node records snapshot item ${index} has an invalid key`);
    }
    const identity = `${snapshotKey(item)}\u0000${item.key}`;
    if (seen.has(identity)) {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `node records snapshot item ${index} is duplicated`);
    }
    seen.add(identity);
  }
  return snapshot;
}

function snapshotFor(snapshot, kind, layer) {
  return snapshot.filter((item) => item.kind === kind && item.layer === layer);
}

function recordsFacility(snapshot, writes = []) {
  return {
    export({ kind, layer, layerIndex }) {
      const current = snapshotFor(snapshot, kind, layerIndex);
      if (typeof layer.records !== "string") {
        throw new RecoveryError("INVALID_RECOVERY_REGISTER", `${kind}[${layerIndex}] is not a keyed records layer`);
      }
      return current
        .filter((item) => item.present && keyMatches(layer.records, item.key))
        .map((item) => ({ key: item.key, value: item.value }));
    },
    import({ kind, layer, layerIndex, records }) {
      if (typeof layer.records !== "string") {
        throw new RecoveryError("INVALID_RECOVERY_REGISTER", `${kind}[${layerIndex}] is not a keyed records layer`);
      }
      if (isRecordKeyPattern(layer.records)) {
        for (const record of records) {
          writes.push({ action: "write", kind, layer: layerIndex, key: record.key, value: record.value });
        }
        return;
      }
      if (records.length > 1) {
        throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${kind}[${layerIndex}] has more than one record`);
      }
      if (records.length === 1) {
        writes.push({
          action: "write",
          kind,
          layer: layerIndex,
          key: records[0].key,
          value: records[0].value,
        });
      }
    },
  };
}

/** Export the records layers in the register through the portable contract. */
export async function exportRecordRecovery({ register, snapshot }) {
  validateSnapshot(snapshot);
  recordLayerDescriptors(register);
  return exportRecovery({ register, facilities: { records: recordsFacility(snapshot) } });
}

/** Return a complete logical write plan after the contract has validated the document. */
export async function importRecordRecovery({ register, document, snapshot }) {
  validateSnapshot(snapshot);
  recordLayerDescriptors(register);
  const writes = [];
  const result = await importRecovery({
    document,
    register,
    facilities: { records: recordsFacility(snapshot, writes) },
  });
  return { ...result, writes };
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function parseSnapshotInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RecoveryError("INVALID_RECOVERY_RECORDS", "node recovery input must be a JSON object");
  }
  validateSnapshot(value.records);
  return value;
}

async function cli() {
  const input = parseSnapshotInput(JSON.parse(await readStdin()));
  const register = registerForLayerKinds(registerData, ["records"]);
  if (process.argv.includes("--export")) {
    process.stdout.write(`${JSON.stringify(await exportRecordRecovery({ register, snapshot: input.records }))}\n`);
    return;
  }
  if (process.argv.includes("--import")) {
    if (!Object.hasOwn(input, "document")) {
      throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", "node recovery import has no document");
    }
    const result = await importRecordRecovery({
      register,
      document: input.document,
      snapshot: input.records,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error("recovery records command needs --export or --import");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/recovery-records.mjs")) {
  cli().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
