# Recovery export and git-base restore

This repository's portable recovery contract is implemented in
[`src/lib/recovery.ts`](../src/lib/recovery.ts). It is host-neutral code: a
facility author supplies access to a store, while the contract supplies the
format, register selection, and validation. Host bindings and credentials stay
in the facility's deployment tooling.

## The intermediate format

The document is JSON and names both its format and its version. Version 1 has
one `entries` member for every register entry whose `recovery` is `keep`. Each
entry has one record payload for every non-git layer it declares; `layer` is
the zero-based layer position in the register entry. Git layers are part of the
repository base and are moved by the git SOP below, so they have no payload in
this document. They are listed in `gitBase` so the selection is explicit.

```json
{
  "format": "blogu-recovery",
  "version": 1,
  "entries": {
    "comments": {
      "records": [
        {
          "layer": 0,
          "records": [{
            "activityId": "https://remote.example/activities/1",
            "objectId": "https://remote.example/notes/1",
            "rootId": null,
            "replyToId": null,
            "actorId": "https://remote.example/users/alice",
            "content": "Hello",
            "published": "2026-10-12T00:00:00.000Z",
            "receivedAt": "2026-10-12T00:00:01.000Z",
            "deletedAt": null,
            "promotedAt": null
          }]
        }
      ]
    },
    "promoted-comments": {
      "records": [
        {
          "layer": 1,
          "records": { "deletedAt": null, "promotedAt": "2026-10-12T00:00:02.000Z" }
        }
      ]
    }
  },
  "gitBase": [
    { "kind": "promoted-comments", "layer": 0 }
  ],
  "leftOut": [
    { "kind": "sessions", "recovery": "ephemeral", "reason": "ephemeral on restore" }
  ],
  "ownerHeld": ["AP_KEY_JWK"]
}
```

The payload shape is fixed by the register layer, so an export from one
facility can be imported by another facility for the same store kind:

- `sql` layers are an array of rows. Each row is an object with exactly the
  logical column names (the keys of the layer's `columns` map), and each value
  is a JSON scalar (`null`, string, boolean, or finite number). A facility maps
  those names to and from its physical columns.
- A keyed `records` layer (`records` is a string) is an array of objects with
  exactly `key` and `value`. `key` is the register's declared key, with any
  pattern placeholders resolved, and `value` is the stored JSON value.
- A keyless `records: true` layer and `memory` layers retain the generic JSON
  payload used by the reference facility. Other host-neutral layer kinds use
  their declared facility contract.

The contract validates these shapes on export and before the first import write.
It is not a database dump and must not contain credentials. The register layer
position keeps multiple layers of one entry distinct.

The selection is computed from `src/data.config.json` by `selectRecovery()`:

- `keep` entries are exported, reading every declared non-git layer.
- `rebuild`, `reset`, `ephemeral`, and `none` entries are absent from
  `entries` and listed in `leftOut` with the reason for exclusion.
- `owner-held` entries are absent from `entries` and listed by name in
  `ownerHeld`. Their value is never placed in the document.
- Git layers are absent from `entries` payloads and listed in `gitBase`; the
  repository backup and restore procedure carries them.

An import accepts only the named format version and the exact selection for the
register it is given. It validates the whole document and all facility coverage
before the first facility import call. An unknown version therefore fails
without writing anything. A facility failure is reported as a
`RecoveryError` with `code` `RECOVERY_EXPORT_FAILED` or
`RECOVERY_IMPORT_FAILED`; an entry is never silently skipped. Version 1 ignores
unknown wrapper fields and entry ordering, while the format and version fields,
the selected entry names, and every declared layer remain required.

## Facility interface

Implement both methods on `RecoveryFacility` in `src/lib/recovery.ts`:

```ts
interface RecoveryFacility {
  export(request: {
    kind: string;
    entry: RecoveryEntry;
    layer: RecoveryLayer;
    layerIndex: number;
  }): unknown | Promise<unknown>;

  import(request: {
    kind: string;
    entry: RecoveryEntry;
    layer: RecoveryLayer;
    layerIndex: number;
    records: unknown;
  }): void | Promise<void>;
}
```

Register the implementation under the layer kind it handles (`sql`,
`records`, `memory`, or another declared kind) and call `exportRecovery()` or
`importRecovery()`. Git has no facility in this contract: the git base follows
the SOP. The `InMemoryRecoveryFacility` in the same module is the reference
implementation. `tests/recovery.test.mjs` proves its export → import → export
round trip, logical-to-physical SQL mapping, and failure paths.

Each facility owns its own transaction boundary and must make its import atomic
for that store. The contract preflight prevents a bad document or missing
facility from starting any import, but independent facilities cannot share one
transaction; a partial cross-facility import must be repaired by rerunning the
same document or by the facility's own recovery procedure.

## Git-base backup and restore SOP

This procedure covers the repository's tracked git base: content, configuration,
and the git-side records named by the register. It does not back up runtime
stores (D1, KV, SQLite, or local records); use that facility's recovery export.
It also does not contain owner-held secrets, external accounts, or deployment
variables listed by name in the register.

Use a bundle so the backup is one verifiable file and does not depend on a
network remote. Run these steps from a clean checkout:

```sh
set -eu
backup=$(mktemp "${TMPDIR:-/tmp}/blogu-git-base.bundle.XXXXXX")
restore=$(mktemp -d "${TMPDIR:-/tmp}/blogu-git-restore.XXXXXX")
cleanup() { rm -f "$backup"; rm -rf "$restore"; }
trap cleanup EXIT

test -z "$(git status --porcelain)"
git bundle create "$backup" --all
git bundle verify "$backup"
git clone "$backup" "$restore"
git -C "$restore" fsck --strict
test "$(git rev-parse HEAD)" = "$(git -C "$restore" rev-parse HEAD)"
git diff --exit-code --no-ext-diff HEAD --
git -C "$restore" diff --exit-code --no-ext-diff HEAD --
git ls-files -s > "$restore.expected-index"
git -C "$restore" ls-files -s > "$restore.actual-index"
cmp "$restore.expected-index" "$restore.actual-index"
```

The checks establish that the source was clean, the bundle is readable, the
fresh clone has a verified object database and the same commit and tracked tree,
and the restored working tree has no changes. Keep the bundle according to the
owner's retention policy; discard it when that policy says it is no longer
needed.
