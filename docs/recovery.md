# Recovery export and git-base restore

This repository's portable recovery contract is implemented in
[`src/lib/recovery.ts`](../src/lib/recovery.ts). It is host-neutral code: a
facility author supplies access to a store, while the contract supplies the
format, register selection, and validation. Host bindings and credentials stay
in the facility's deployment tooling.

The node records pair and the SQLite/D1 pairs keep their host-free adapters in
[`scripts/recovery-records.mjs`](../scripts/recovery-records.mjs) and
[`scripts/recovery-sql.mjs`](../scripts/recovery-sql.mjs). Both use
[`scripts/recovery-plan.mjs`](../scripts/recovery-plan.mjs):
`planRecoveryImport({ register, document, kind, facility, existing, existingReason? })` refuses
a non-empty destination and validates the complete document before asking the
supplied `facility(request)` function to build logical writes in memory.
`existing` must be a boolean; the optional `existingReason` preserves a
facility's refusal detail, such as the non-empty directory's path.
`runRecoveryAdapter({ exportFn, importFn })` owns both adapters' stdin and
stdout: an object with a required boolean `existing`, plus `document` for
import, produces one JSON result or a failure.
`runRecoveryReader({ label, snapshot, prepare, apply })` owns all three readers'
mode dispatch, stdin parsing and JSON stdout. It requires exactly one of
`--snapshot`, `--validate-plan` or `--apply-plan` before reading input or calling
the supplied operations; `--import` selects the destination snapshot. The
shell uses the same preview path for every facility. Neither planner accesses
a store. The bash entry points under
`scripts/platform/node/` and `scripts/platform/cloudflare/` exchange JSON
snapshots and write plans with these adapters; their readers own store access
and the final commit. `FACILITY=sqlite` selects SQLite through Make, while
records remains the node default (`FACILITY=records`). Cloudflare currently
provides `FACILITY=d1`, its default.

`scripts/platform/flags.sh` owns state-flag parsing, opt-in `--file`, the
document-input reader and the atomic export-file write. Targets declare their
accepted facilities. `scripts/platform/recovery.sh` owns the shared
snapshot → adapter → validate/apply pipeline, including preview validation.
The target hooks select a reader and an adapter; they do not copy this flow.
Export writes a mode-`0600` sibling temporary file before renaming it into
`FILE`, and prints the document after any requested file write succeeds. An
interrupted file write can leave a `.blogu-recovery-export.*` file beside the
destination. A successful snapshot remains usable if temporary-file cleanup
fails: export still prints the document and writes it with `--apply --file`,
and import still validates and prints its preview plan (or applies it when
requested). The command then exits non-zero with the leftover directory named
on stderr. A failed read stops before any export-file or destination write.

`scripts/recovery-sql.mjs` builds the SQLite SELECT, INSERT, clearing and
user-schema queries as SQL plus bound parameters. It owns logical aliases,
column order and boolean conversion; targets execute those statements and
own connections and transactions. `sqlUserSchemaStatement` accepts excluded
prefixes and exact names, so each target can recognise its internal schema.
`validateSqlPlan` checks the complete logical plan for both SQL readers;
SQLite adds its in-memory constraint and round-trip checks. Quoting and
record-key placeholder grammar have one owner in `src/lib/recovery.ts`, also
used by the register generator and consumer checker. The command modules use
`scripts/run-cli.mjs` for main-module detection and failure reporting, including
when invoked through a renamed file or a filesystem alias.

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
- `memory` layers retain the generic JSON payload used by the reference
  facility. A keyless `records: true` layer has no portable node-records
  payload; other host-neutral layer kinds use their declared facility contract.

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

## Node local JSON records export and import SOP

This SOP covers the node target's JSON records under `AP_DATA_DIR`. The
credential is **file access to that data directory**; no API token or value from
the directory belongs in the recovery document. The node pair selects the
register entries whose layers are local `records` layers (and their declared
git base), while carrying owner-held names without their values. SQLite, KV and
other facilities have their own pair and document.

Run every command from the repository root. The commands are selected by
`DEPLOY_TARGET=node`, and `AP_DATA_DIR` defaults to `.data` when it is omitted.
The default facility is `records`; it can also be selected explicitly with
`FACILITY=records` (or `--facility records` on the bash entry points).
Use an absolute directory for a move so the source and destination cannot be
confused.

1. Confirm that the operator has read and write file access to the source
   `AP_DATA_DIR` directory and the destination parent directory. Keep the recovery document in a
   separate location with the same access control.
2. Generate the register consumers and validate the register:

   ```sh
   make data
   ```

3. Preview an export from the source. Redirect stdout to a new recovery file;
   this does not change the data directory:

   ```sh
   DEPLOY_TARGET=node AP_DATA_DIR=/srv/blogu-data \
     make recovery-export > /srv/backup/blogu-node-records.json
   ```

   Inspect that the output starts with `"format":"blogu-recovery"`, has
   `"version":1`, contains no credential, and names the expected record keys.
4. If the owner wants the command itself to write the document, repeat the
   export with an explicit state flag and output file. Both forms print the
   document to stdout:

   ```sh
   DEPLOY_TARGET=node AP_DATA_DIR=/srv/blogu-data \
     make recovery-export APPLY=1 FILE=/srv/backup/blogu-node-records.json
   ```

5. Choose an empty or absent destination path whose parent directory already
   exists. An import destination is non-empty when `AP_DATA_DIR` contains any
   entry; the import refuses it and does not merge or silently overwrite files.
   Preview the import first:

   ```sh
   DEPLOY_TARGET=node AP_DATA_DIR=/srv/blogu-new \
     make recovery-import FILE=/srv/backup/blogu-node-records.json
   ```

6. Apply the import only after the preview is correct:

   ```sh
   DEPLOY_TARGET=node AP_DATA_DIR=/srv/blogu-new \
     make recovery-import APPLY=1 FILE=/srv/backup/blogu-node-records.json
   ```

   The target stages every record in a complete sibling directory and commits
   it with one rename into the destination. A crash before that rename leaves
   the old empty or absent destination and can be repaired by rerunning the
   import, after deleting the `.blogu-recovery-stage-*` directory it leaves
   beside the destination — it holds the staged records; after the rename the
   destination is complete. A malformed document
   or a non-empty store leaves the destination untouched.
7. Export the destination and compare the two documents. Both exports use the
   same register order and JSON values, so a byte comparison is evidence of the
   round trip:

   ```sh
   DEPLOY_TARGET=node AP_DATA_DIR=/srv/blogu-new \
     make recovery-export > /srv/backup/blogu-node-records-after.json
   cmp /srv/backup/blogu-node-records.json \
       /srv/backup/blogu-node-records-after.json
   ```

The owner must run this SOP once against temporary source and destination
directories and record the result in the issue. **[ ] Not followed by this
repository change.**

## Node SQLite export and import SOP

This pair covers the node target's SQL store through `node:sqlite`. Its
credential is **file access to the database file and its data directory**:
read access for export, and write access to the destination parent for import.
No API credential is needed or exported. `AP_DB_URL` names the database file;
when omitted, both runtime and recovery use `interactions.sqlite` under
`AP_DATA_DIR` (default `.data`), through `src/platform/node/sqlite.ts`.

The pair selects `registerForLayerKinds(register, ["sql"])` and retains only
`recovery: keep` payloads. Currently these are reactions, migrations, and
comments; owner-held entries travel as names only. Table and physical column
names come from the register, while rows in the document use logical names.
Rows are sorted by their canonical JSON representation for repeatable exports.
Git, JSON records and owner-held values still need their own recovery steps.

Run from the repository root with the same checkout, register and migration
history used by the source instance. Use absolute paths. Stop the node process
and other writers for the move, and leave them stopped until verification is
complete. Import is an offline replacement, not a concurrent merge. When
restoring both node facilities into one data directory, restore JSON records
first; that pair refuses any directory entry, including a SQLite database.

1. Confirm file access to the source and destination parent. Choose a separate
   backup directory with restricted access. The source database must exist and
   have its runtime schema; export opens it read-only in one read transaction
   and refuses missing files or selected tables. Generate the register files:

   ```sh
   make data
   umask 077
   ```

2. Preview the export. Redirecting stdout creates the backup without changing
   the source database:

   ```sh
   DEPLOY_TARGET=node AP_DB_URL=/srv/blogu-data/interactions.sqlite \
     make recovery-export FACILITY=sqlite > /srv/backup/blogu-node-sqlite.json
   ```

   Inspect `format: "blogu-recovery"`, `version: 1`, the expected selected
   entries and logical column names. The document contains stored data and
   must have the same access protection as the source. Keep it outside the
   source and destination database paths.
3. Alternatively, have the command write the backup explicitly. It still
   prints the document to stdout; without `APPLY=1`, `FILE` is not written:

   ```sh
   DEPLOY_TARGET=node AP_DB_URL=/srv/blogu-data/interactions.sqlite \
     make recovery-export FACILITY=sqlite APPLY=1 FILE=/srv/backup/blogu-node-sqlite.json
   ```

4. Choose an absent database file, a zero-byte file, or a SQLite file without
   user schema. Its parent must already exist. Any user table, view, index or
   trigger makes the destination non-empty, even without rows. An initialized
   runtime database is non-empty. Import also refuses symlinks, non-files,
   invalid SQLite files and destinations with `-wal`, `-shm` or `-journal`
   sidecars; choose a fresh destination rather than deleting live sidecars.
   Preview the import:

   ```sh
   DEPLOY_TARGET=node AP_DB_URL=/srv/blogu-new/interactions.sqlite \
     make recovery-import FACILITY=sqlite FILE=/srv/backup/blogu-node-sqlite.json
   ```

   Preview validates the whole document and exercises the runtime schema and
   constraints in an in-memory SQLite database. It creates no destination or
   staging file. The write plan lists all selected layers, including empty
   ones. Wrong versions, missing layers, malformed rows and SQLite constraint
   failures refuse the import before filesystem writes. Re-exporting the
   in-memory database must preserve the payload exactly; values that SQLite
   would silently coerce (such as a number in a text column) are refused too.
5. Apply after inspecting the preview:

   ```sh
   DEPLOY_TARGET=node AP_DB_URL=/srv/blogu-new/interactions.sqlite \
     make recovery-import FACILITY=sqlite APPLY=1 FILE=/srv/backup/blogu-node-sqlite.json
   ```

   The importer repeats validation, builds the schema with the runtime's
   append-only migrations, and restores the selected tables in a transaction
   in a sibling `.blogu-recovery-sqlite-*` directory. Bootstrap migration rows
   are replaced by the exported ledger. After closing the database, it checks
   the destination again and publishes the complete file with one rename.
   The restored file is mode `0600`; run the command as the runtime's file
   owner or arrange its file access before restarting.

   A failure before the rename leaves the destination untouched. A process
   crash before it leaves the old empty or absent destination; after it, the
   restored database is complete. A crash can leave a sibling staging
   directory containing data. With writers still stopped, inspect and remove
   that specific abandoned directory. If the target is still empty, rerun
   import; if complete, verify it rather than importing over it.
6. Export the destination and compare bytes before restarting the node process:

   ```sh
   DEPLOY_TARGET=node AP_DB_URL=/srv/blogu-new/interactions.sqlite \
     make recovery-export FACILITY=sqlite > /srv/backup/blogu-node-sqlite-after.json
   cmp /srv/backup/blogu-node-sqlite.json /srv/backup/blogu-node-sqlite-after.json
   ```

   Point the runtime's `AP_DB_URL` at the restored file, complete the other
   facility and owner-held recovery steps, and restart. Preserve the backup
   according to the owner's retention policy.

`tests/platform-sqlite-recovery.test.mjs` exercises temporary SQLite files,
byte-identical exports, the in-memory reference facility in both directions,
preview and refusal behavior, constraints, and process crashes around the
rename. `tests/recovery-sql.test.mjs` covers the logical payload and the shared
planner. These automated checks do not attest an operator rehearsal.

The owner must follow this SOP once with temporary source and destination
files and record the result in the issue. **[ ] Followed once.**

## Cloudflare D1 export and import SOP

This pair covers the SQL facility in Cloudflare D1. The credential is an
**owner-held Cloudflare account API token with D1 Read for export and D1 Write
for import**, restricted to the intended account, or an owner's Wrangler
login with equivalent access. Import also reads the destination schema. Use
`CLOUDFLARE_API_TOKEN` for the token and `CLOUDFLARE_ACCOUNT_ID` to select the
account; `CF_D1_ID` selects the database by ID on every command. These are
operator credentials, not CI secrets for this procedure. No token or login
value is written into a recovery document.

The pair uses the same SQL register slice, logical column payload and canonical
row ordering as node SQLite. Only `recovery: keep` SQL layers are transferred;
owner-held entries are names only. It reads all selected tables and fails on
a missing table, failed statement or incomplete response. Cloudflare's
`_cf_*` objects, SQLite's `sqlite_*` objects, and the exact `d1_migrations`
table are internal schema. They are neither transferred nor cleared. Any
other schema object makes an import destination non-empty, even an empty
application table. An initialized blog database is not an empty destination.

The target reader is `scripts/platform/cloudflare/d1.mjs`. It runs the installed
Wrangler through `npx --no-install`, using a temporary config containing only
the selected D1 binding. It does not regenerate the site's Wrangler config
or require `CF_KV_ID`. The shared SQL statements remain `{ sql, parameters }`;
because Wrangler's CLI has no parameter-binding option, the D1 transport
renders their bound scalars into SQL literals, encoding strings as UTF-8 hex
cast to text. Document values never supply SQL or identifiers. The temporary
config and import SQL file have mode `0600` inside a private temporary directory
and are removed after the command finishes. A killed process can leave that
directory (`blogu-d1-recovery-*` under `TMPDIR`); its SQL file contains data.

The commit boundary is **one remote SQL-file import** (`wrangler d1 execute
--remote --file`). Wrangler runs an import job (init → upload → ingest → poll),
so rollback is a provider guarantee, not a client-side SQL transaction.
Cloudflare's [April 2024 D1 GA announcement](https://blog.cloudflare.com/building-d1-a-global-database/)
states that `wrangler d1 execute --file` imports are atomic and never leave the
database half-imported. Wrangler's remote-file import prompt, also reproduced
in [cloudflare/workers-sdk#8020](https://github.com/cloudflare/workers-sdk/issues/8020),
says: "if the execution fails to complete, your DB will return to its original
state and you can safely retry".

This path and prompt were checked against the installed **Wrangler 4.132.0**
source on October 13, 2026. Wrangler is not a direct dependency:
`package-lock.json` resolves it through the Cloudflare adapter's `^4.125.0`
peer range. `npm ci` keeps that locked version. Older Wrangler 2.x split large
files into separate batches, so the guarantee depends on the version and
must be rechecked when updating the lockfile.

The file first checks that user schema is still absent, then bootstraps the runtime's
append-only schema history and inserts every selected payload, including the
exported migration ledger. `schemaBootstrapStatements()` in
`src/integrations/activitypub/store/schema.ts` supplies the same schema history
as the runtime; recovery does not invent migrations or timestamps. There are
no per-row remote writes, merge, table clearing or partial-batch retries. The
generated SQL contains no `BEGIN`, `COMMIT` or `SAVEPOINT`; D1 rejects them.

The guarantee is weaker than node SQLite in two ways. Preview validates the
entire document and logical plan but cannot rehearse D1's constraints or
type affinity in an in-memory instance of that service. Constraint failures
are detected when D1 executes the import; a valid scalar can be coerced to a
different storage type. Also, losing a connection or acknowledgement can
leave a complete remote import whose result the caller does not know. A
non-zero exit after submission without an acknowledged result means
**unconfirmed**, not proof of rollback.
The tool never retries automatically. A confirmed D1 execution failure relies
on the service restoring the original database; offline tests cannot prove
that service guarantee. Keep writers stopped and compare exports before
switching the application to the destination. An import that succeeds with
wrong data does not trigger failure rollback: use D1 Time Travel to restore a
known pre-import point, within its available recovery window, and verify the
restored state before resuming writers.

Run from the repository root with the same checkout, register and migration
history as the source. Use the installed dependencies. Keep backups outside
the repository in an access-controlled directory.

1. Have the owner supply the account ID and token from their secret store,
   or run `npx --no-install wrangler login` as the owner. Confirm D1 Read on
   the source and D1 Write on the intended destination account. Record the
   source database ID. In Cloudflare D1, create a new destination database
   and record its ID; do not apply migrations or bind an active Worker to it.
   For the rehearsal, both databases must be disposable test instances. Seed
   the source with the runtime schema and at least one valid comment so the
   deliberate constraint failure below reaches D1 execution.
2. Stop every writer to the source and destination: the site Worker, queue
   consumer and any manual database commands. Leave them stopped throughout
   export, import and verification. The export uses one multi-statement read
   request, but does not claim a snapshot spanning concurrent writes. Prepare
   the register and restrict newly created backup files:

   ```sh
   make data
   umask 077
   ```

3. Preview an export, substituting the recorded source ID and an existing
   backup directory. The account ID and credential remain in the owner's
   environment. This form redirects stdout and never changes D1:

   ```sh
   DEPLOY_TARGET=cloudflare CF_D1_ID='source-database-id' \
     make recovery-export FACILITY=d1 > /srv/backup/blogu-d1.json
   ```

   Inspect `format: "blogu-recovery"`, `version: 1`, the selected entries,
   logical columns and owner-held names. Currently the SQL entries are
   reactions, migrations and comments. The document contains stored data;
   protect it like the source. Wrangler's captured response is limited to
   64 MiB; exceeding it fails rather than emitting a partial document.
4. Alternatively, let the command publish the export file atomically. It
   still prints the document to stdout. Without `APPLY=1`, `FILE` is not
   written:

   ```sh
   DEPLOY_TARGET=cloudflare CF_D1_ID='source-database-id' \
     make recovery-export FACILITY=d1 APPLY=1 FILE=/srv/backup/blogu-d1.json
   ```

5. Confirm that the destination ID is different from the source and has no
   user schema. Preview the import against that destination:

   ```sh
   DEPLOY_TARGET=cloudflare CF_D1_ID='destination-database-id' \
     make recovery-import FACILITY=d1 FILE=/srv/backup/blogu-d1.json
   ```

   The preview reads schema and prints a validated plan. It performs no D1
   writes. Wrong versions, selections, layers and malformed rows fail before
   an import is submitted. A successful preview is not a constraint or type
   round-trip check on D1.
6. **Disposable-database rehearsal only:** observe a failed import before the
   successful one. In the D1 console, capture the destination's complete
   schema with `SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name`
   and the rows of any readable pre-existing internal tables. Keep these
   results as the before-state; user schema must be absent.

   Make a separate copy of the export at `/srv/backup/blogu-d1-invalid.json`.
   In that copy, set `entries.comments.records[0].records[0].content` to
   `null`. This passes the recovery format's scalar check but violates the
   runtime's `NOT NULL` constraint. Keep the original backup intact. Preview
   the invalid copy, then deliberately apply it to the disposable destination:

   ```sh
   DEPLOY_TARGET=cloudflare CF_D1_ID='disposable-destination-database-id' \
     make recovery-import FACILITY=d1 FILE=/srv/backup/blogu-d1-invalid.json
   DEPLOY_TARGET=cloudflare CF_D1_ID='disposable-destination-database-id' \
     make recovery-import FACILITY=d1 APPLY=1 FILE=/srv/backup/blogu-d1-invalid.json
   ```

   Expect preview success followed by a non-zero apply exit and no
   `"applied":true` result. That exit alone does not prove rollback. Repeat
   the schema query and internal-row reads from a fresh console request:
   they must match the before-state, with no application tables, indexes or
   partial rows left behind. Preview the original valid backup again; it
   must still accept the destination as empty. Record the Wrangler version,
   refusal and before/after comparison in the issue. Stop if anything differs.
   This deliberate failure and state comparison are the SOP's observation of
   live rollback; the successful round trip and fake tests cannot supply it.
7. Apply after reviewing the preview. The command repeats document validation,
   rechecks the destination, and submits the complete SQL file once:

   ```sh
   DEPLOY_TARGET=cloudflare CF_D1_ID='destination-database-id' \
     make recovery-import FACILITY=d1 APPLY=1 FILE=/srv/backup/blogu-d1.json
   ```

   Only an acknowledged successful import prints `"applied":true`. If local
   temporary-file cleanup then fails, that result is still printed and the
   command exits non-zero. Its diagnostic confirms completion, names the
   leftover directory and tells the owner to delete the recovery data there
   after confirming no importer owns it. Verify the import before cutover;
   a cleanup failure alone does not call for retrying it.

   If submission fails without an acknowledged result, leave writers stopped.
   Try exporting the destination: if it matches the backup, the import
   completed; if it has only internal schema, a fresh preview can precede a
   retry. Any other state
   requires investigation or a new empty destination. Do not clear an
   existing database to make a retry pass. Inspect any abandoned private
   temporary directory and remove it after confirming no importer owns it.
8. Export the destination and compare bytes before binding or restarting the
   application:

   ```sh
   DEPLOY_TARGET=cloudflare CF_D1_ID='destination-database-id' \
     make recovery-export FACILITY=d1 > /srv/backup/blogu-d1-after.json
   cmp /srv/backup/blogu-d1.json /srv/backup/blogu-d1-after.json
   ```

   A mismatch, including a type conversion, must be resolved before cutover.
   Complete other facility and owner-held recovery steps, configure both
   Workers to use the verified destination, and then restart writers. Keep
   the backup under the owner's retention policy.

`tests/platform-d1-recovery.test.mjs` runs the real shell entry points with
fake `npx` on `PATH` and disposable SQLite files. It covers byte-identical
round trips through the in-memory reference, validation before writes,
simulated remote rollback, internal-table preservation and unconfirmed
completion. It makes no Cloudflare requests and cannot establish live D1's
transaction behavior, permissions, limits or an operator rehearsal.

The owner must follow this SOP once against disposable D1 databases and
record the result in the issue. **[ ] Followed once.**
