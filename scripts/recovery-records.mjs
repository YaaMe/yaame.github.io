/**
 * Host-free recovery adapter for a keyed JSON record store.
 *
 * The node entry point supplies one JSON snapshot and receives one JSON write
 * plan. File names, directories and the transaction that applies the plan
 * belong to the node side; this module only applies the recovery contract to
 * logical register records.
 */

import registerData from "../src/data.config.json" with { type: "json" };
import { isRecordKeyPattern, recordKeyMatches } from "../src/lib/key-pattern.ts";
import {
  RecoveryError,
  exportRecovery,
  registerForLayerKinds,
  selectRecovery,
} from "../src/lib/recovery.ts";
import { planRecoveryImport, runRecoveryAdapter } from "./recovery-plan.mjs";
import { runIfMain } from "./run-cli.mjs";

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

function recordsFacility(snapshot) {
  return {
    export({ kind, layer, layerIndex }) {
      const current = snapshotFor(snapshot, kind, layerIndex);
      if (typeof layer.records !== "string") {
        throw new RecoveryError("INVALID_RECOVERY_REGISTER", `${kind}[${layerIndex}] is not a keyed records layer`);
      }
      return current
        .filter((item) => item.present && recordKeyMatches(layer.records, item.key))
        .map((item) => ({ key: item.key, value: item.value }));
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
export async function importRecordRecovery({ register, document, snapshot, existing, existingReason }) {
  validateSnapshot(snapshot);
  recordLayerDescriptors(register);
  return planRecoveryImport({
    document,
    register,
    kind: "records",
    existing: typeof existing === "boolean" ? existing || snapshot.some((item) => item.present) : existing,
    existingReason,
    facility({ kind, layer, layerIndex, records }) {
      if (!isRecordKeyPattern(layer.records) && records.length > 1) {
        throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${kind}[${layerIndex}] has more than one record`);
      }
      return records.map(({ key, value }) => ({ action: "write", kind, layer: layerIndex, key, value }));
    },
  });
}

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
