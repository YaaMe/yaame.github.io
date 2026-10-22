/**
 * The node entry point supplies one JSON snapshot and receives one JSON write
 * plan. File names, directories and the transaction that applies the plan
 * belong to the node side; this module only applies the recovery contract to
 * logical register records.
 */

import { isRecordKeyPattern, recordKeyMatches } from "../../lib/key-pattern.ts";
import { RecoveryError, exportRecovery, registerForLayerKinds, selectRecovery } from "./index.ts";
import type { RecoveryRegister, RecoveryFacility } from "./index.ts";
import { planRecoveryImport } from "./plan.ts";

export type RecordSnapshot = { kind: string; layer: number; key: string; present: boolean; value?: unknown };
export type RecordWrite = { action: string; kind: string; layer: number; key: string; value: unknown };
export type RecordPlan = { imported: string[]; writes: RecordWrite[] };

export function restoreRecordRecovery(plan: RecordPlan, execution: { replace: (writes: RecordWrite[]) => void }) {
  execution.replace(plan.writes);
}

/** Describe the concrete records that a facility can enumerate. */
export function recordLayerDescriptors(register: RecoveryRegister, { allowRecordKeyPatterns = true } = {}) {
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

function snapshotKey(item: RecordSnapshot) {
  return `${item.kind}\u0000${item.layer}`;
}

function validateSnapshot(snapshot: RecordSnapshot[]) {
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

function snapshotFor(snapshot: RecordSnapshot[], kind: string, layer: number) {
  return snapshot.filter((item) => item.kind === kind && item.layer === layer);
}

function recordsFacility(snapshot: RecordSnapshot[]): Pick<RecoveryFacility, "export"> {
  return {
    export({ kind, layer, layerIndex }) {
      const current = snapshotFor(snapshot, kind, layerIndex);
      if (typeof layer.records !== "string") {
        throw new RecoveryError("INVALID_RECOVERY_REGISTER", `${kind}[${layerIndex}] is not a keyed records layer`);
      }
      return current
        .filter((item) => item.present && recordKeyMatches(layer.records as string, item.key))
        .map((item) => ({ key: item.key, value: item.value }));
    },
  };
}

/** Export the records layers in the register through the portable contract. */
export async function exportRecordRecovery({ register, snapshot }: { register: RecoveryRegister; snapshot: RecordSnapshot[] }) {
  validateSnapshot(snapshot);
  recordLayerDescriptors(register);
  return exportRecovery({ register, facilities: { records: recordsFacility(snapshot) } });
}

/** Return a complete logical write plan after the contract has validated the document. */
export async function importRecordRecovery({ register, document, snapshot, existing, existingReason }: {
  register: RecoveryRegister;
  document: unknown;
  snapshot: RecordSnapshot[];
  existing: unknown;
  existingReason?: string | null;
}) {
  validateSnapshot(snapshot);
  recordLayerDescriptors(register);
  return planRecoveryImport({
    document,
    register,
    kind: "records",
    existing: typeof existing === "boolean" ? existing || snapshot.some((item) => item.present) : existing,
    existingReason,
    facility({ kind, layer, layerIndex, records: payload }) {
      const records = payload as Array<{ key: string; value: unknown }>;
      if (!isRecordKeyPattern(layer.records as string) && records.length > 1) {
        throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${kind}[${layerIndex}] has more than one record`);
      }
      return records.map(({ key, value }) => ({ action: "write", kind, layer: layerIndex, key, value }));
    },
  });
}
