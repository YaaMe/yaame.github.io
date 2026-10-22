#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import registerData from "../../../src/config/data.config.json" with { type: "json" };
import { recordFile, nodeRecordDescriptors, validateRecordPlan } from "../../../src/platform/node/recovery-records.ts";
import { restoreRecordRecovery } from "../../../src/services/recovery/records.ts";
import { requireEmptyDestination } from "../../../src/services/recovery/plan.ts";
import { registerForLayerKinds } from "../../../src/services/recovery/index.ts";
import { runRecoveryReader } from "../../recovery-plan.mjs";
import { runIfMain } from "../../run-cli.mjs";

const dataDir = process.env.AP_DATA_DIR ?? ".data";

function fail(message) {
  throw new Error(message);
}

function existingDirectory(path, label) {
  if (!existsSync(path)) fail(label + " does not exist: " + path);
  if (!lstatSync(path).isDirectory()) fail(label + " is not a directory: " + path);
  return true;
}

function requireParent(path) {
  const parent = dirname(path);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
    fail("AP_DATA_DIR parent does not exist or is not a directory: " + parent);
  }
  return parent;
}

function destinationConflict(path) {
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isDirectory()) return `destination is not a directory: ${path}`;
  return readdirSync(path).length > 0 ? `destination contains entries: ${path}` : null;
}

function readSnapshot() {
  const register = registerForLayerKinds(registerData, ["records"]);
  existingDirectory(dataDir, "AP_DATA_DIR");
  const descriptors = nodeRecordDescriptors(register);
  const records = descriptors.map(({ kind, layer, key }) => {
    const path = recordFile(dataDir, key);
    if (!existsSync(path)) return { kind, layer, key, present: false };
    if (!lstatSync(path).isFile()) fail("record file is not a regular file: " + path);
    return { kind, layer, key, present: true, value: JSON.parse(readFileSync(path, "utf8")) };
  });
  return records;
}

function snapshot(importMode) {
  if (importMode) requireParent(dataDir);
  const existingReason = importMode ? destinationConflict(dataDir) : null;
  return importMode
    ? { records: [], existing: existingReason !== null, existingReason }
    : { records: readSnapshot(), existing: destinationConflict(dataDir) !== null };
}

function replaceRecords(writes) {
  const parent = requireParent(dataDir);
  const conflict = destinationConflict(dataDir);
  requireEmptyDestination(Boolean(conflict), conflict);
  const stage = mkdtempSync(join(parent, ".blogu-recovery-stage-"));
  try {
    for (const write of writes) {
      writeFileSync(recordFile(stage, write.key), JSON.stringify(write.value));
    }
    if (process.env.RECOVERY_TEST_KILL_AT_COMMIT === "before") process.kill(process.pid, "SIGKILL");
    renameSync(stage, dataDir);
    if (process.env.RECOVERY_TEST_KILL_AT_COMMIT === "after") process.kill(process.pid, "SIGKILL");
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

function cli() {
  return runRecoveryReader({ label: "node records reader", snapshot, prepare: (plan) => validateRecordPlan(dataDir, plan), apply: (plan) => restoreRecordRecovery(plan, { replace: replaceRecords }) });
}

await runIfMain(import.meta.url, cli);
