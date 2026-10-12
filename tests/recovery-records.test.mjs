import test from "node:test";
import assert from "node:assert/strict";

import {
  exportRecordRecovery,
  importRecordRecovery,
} from "../scripts/recovery-records.mjs";
import {
  InMemoryRecoveryFacility,
  exportRecovery,
  importRecovery,
} from "../src/lib/recovery.ts";

const register = {
  followers: {
    layers: [{ records: "ap:followers", format: "json" }],
    writeBack: [],
    origin: "others",
    recovery: "keep",
    purposes: ["federation"],
    description: "followers",
  },
  following: {
    layers: [{ records: "ap:following", format: "json" }],
    writeBack: [],
    origin: "others",
    recovery: "keep",
    purposes: ["federation"],
    description: "following",
  },
  sessions: {
    layers: [{ records: "auth:session:{id}", format: "json" }],
    list: "never",
    writeBack: [],
    origin: "owner",
    recovery: "ephemeral",
    purposes: ["auth"],
    description: "sessions",
  },
};

const sourceSnapshot = [
  { kind: "followers", layer: 0, key: "ap:followers", present: true, value: [{ id: "alice" }] },
  { kind: "following", layer: 0, key: "ap:following", present: true, value: [{ id: "bob" }] },
];

test("records export matches placeholder keys literally around metacharacters", async () => {
  const selected = { patterned: { recovery: "keep", layers: [{ records: "ap.[x]+:{owner_id}:{Token2}", format: "json" }] } };
  const snapshot = ["ap.[x]+:alice:token", "apXx:alice:token", "ap.[x]+::token"].map((key) => ({
    kind: "patterned", layer: 0, key, present: true, value: key,
  }));
  const document = await exportRecordRecovery({ register: selected, snapshot });
  assert.deepEqual(document.entries.patterned.records[0].records, [
    { key: "ap.[x]+:alice:token", value: "ap.[x]+:alice:token" },
  ]);
  const plan = await importRecordRecovery({ register: selected, document, snapshot: [], existing: false });
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].key, "ap.[x]+:alice:token");
});

test("record recovery refuses existing records before returning a plan", async () => {
  const document = await exportRecordRecovery({ register, snapshot: sourceSnapshot });
  await assert.rejects(importRecordRecovery({ register, document, snapshot: [] }), /existing must be a boolean/);
  for (const input of [{ snapshot: sourceSnapshot, existing: false }, { snapshot: [], existing: true }]) {
    await assert.rejects(importRecordRecovery({ register, document, ...input }), /non-empty store/);
  }
});

test("node records export and import round-trip through the portable contract", async () => {
  const document = await exportRecordRecovery({ register, snapshot: sourceSnapshot });
  const writes = await importRecordRecovery({ register, document, snapshot: [], existing: false });

  assert.deepEqual(writes.writes, [
    { action: "write", kind: "followers", layer: 0, key: "ap:followers", value: [{ id: "alice" }] },
    { action: "write", kind: "following", layer: 0, key: "ap:following", value: [{ id: "bob" }] },
  ]);

  const targetSnapshot = writes.writes.map((write, index) => ({
    kind: index === 0 ? "followers" : "following",
    layer: 0,
    key: write.key,
    present: true,
    value: write.value,
  }));
  assert.deepEqual(
    await exportRecordRecovery({ register, snapshot: targetSnapshot }),
    document,
  );
});

test("the node records document imports into the in-memory reference facility", async () => {
  const document = await exportRecordRecovery({ register, snapshot: sourceSnapshot });
  const target = new InMemoryRecoveryFacility();
  await importRecovery({
    document,
    register,
    facilities: { records: target },
  });
  assert.deepEqual(
    await exportRecovery({ register, facilities: { records: target } }),
    document,
  );
});

test("a malformed document is rejected before a node records write plan", async () => {
  await assert.rejects(
    importRecordRecovery({
      register,
      document: {
        format: "blogu-recovery",
        version: 1,
        entries: {
          followers: { records: [{ layer: 0, records: [{ key: "ap:followers", value: { bad: () => 1 } }] }] },
          following: { records: [{ layer: 0, records: [] }] },
        },
        gitBase: [],
        leftOut: [{ kind: "sessions", recovery: "ephemeral", reason: "ephemeral on restore" }],
        ownerHeld: [],
      },
      snapshot: [],
      existing: false,
    }),
    (error) => error.code === "INVALID_RECOVERY_RECORDS",
  );
});
