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
import registerData from "../../../src/data.config.json" with { type: "json" };
import { recordFile } from "../../../src/platform/node-records.ts";
import { recordLayerDescriptors } from "../../recovery-records.mjs";
import { registerForLayerKinds } from "../../../src/lib/recovery.ts";
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
  const descriptors = recordLayerDescriptors(register, { allowRecordKeyPatterns: false });
  const records = descriptors.map(({ kind, layer, key }) => {
    const path = recordFile(dataDir, key);
    if (!existsSync(path)) return { kind, layer, key, present: false };
    if (!lstatSync(path).isFile()) fail("record file is not a regular file: " + path);
    return { kind, layer, key, present: true, value: JSON.parse(readFileSync(path, "utf8")) };
  });
  return records;
}

function snapshotCommand(file, importMode) {
  if (importMode) requireParent(dataDir);
  const existingReason = importMode ? destinationConflict(dataDir) : null;
  const value = importMode
    ? { records: [], existing: existingReason !== null, existingReason }
    : { records: readSnapshot(), existing: destinationConflict(dataDir) !== null };
  if (file) value.document = JSON.parse(readFileSync(file, "utf8"));
  process.stdout.write(JSON.stringify(value) + "\n");
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.writes)) {
    fail("recovery write plan is malformed");
  }
  const keys = new Set();
  for (const [index, write] of plan.writes.entries()) {
    if (!write || write.action !== "write" || typeof write.key !== "string" || !Object.hasOwn(write, "value")) {
      fail("recovery write plan item " + index + " is not a keyed write");
    }
    const path = recordFile(dataDir, write.key);
    if (keys.has(path)) fail("recovery write plan contains the same physical file twice: " + path);
    keys.add(path);
  }
}

function applyPlan(plan) {
  const parent = requireParent(dataDir);
  const conflict = destinationConflict(dataDir);
  if (conflict) fail(`cannot import into a non-empty store: ${conflict}`);
  const stage = mkdtempSync(join(parent, ".blogu-recovery-stage-"));
  try {
    for (const write of plan.writes) {
      writeFileSync(recordFile(stage, write.key), JSON.stringify(write.value));
    }
    if (process.env.RECOVERY_TEST_KILL_AT_COMMIT === "before") process.kill(process.pid, "SIGKILL");
    renameSync(stage, dataDir);
    if (process.env.RECOVERY_TEST_KILL_AT_COMMIT === "after") process.kill(process.pid, "SIGKILL");
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(JSON.stringify({ ...plan, applied: true }) + "\n");
}

function cli() {
  const argv = process.argv.slice(2);
  if (argv.includes("--snapshot")) {
    const fileIndex = argv.indexOf("--file");
    const file = fileIndex === -1 ? undefined : argv[fileIndex + 1];
    if (fileIndex !== -1 && !file) fail("--file needs a value");
    snapshotCommand(file, argv.includes("--import"));
    return;
  }
  if (argv.includes("--apply-plan") || argv.includes("--validate-plan")) {
    const plan = JSON.parse(readFileSync(0, "utf8"));
    validatePlan(plan);
    if (argv.includes("--apply-plan")) applyPlan(plan);
    else process.stdout.write(JSON.stringify(plan) + "\n");
    return;
  }
  fail("node records reader needs --snapshot, --validate-plan or --apply-plan");
}

await runIfMain(import.meta.url, cli);
