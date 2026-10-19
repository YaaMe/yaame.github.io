# Platform entry points

Each target directory contains the host-specific entry points used by the
Makefile and scheduled workflows. A target must provide `promote.sh`,
`tombstone.sh` and `unpromote.sh`, and must run them from the repository root.
Every entry point defaults to a dry run and accepts `--dry-run`, `--apply`, and
`--help`; passing both state flags is an error. `--help` prints usage and exits
without reading or changing state. Promotion and tombstone previews print the
`APPLY_HINT` supplied by a wrapper when they find changes (or `--apply` when
called directly); unpromotion never prints an apply hint because it deletes a
production D1 row. A preview and an apply both print their result to stdout;
failures and diagnostics use stderr and a non-zero exit code.

`scripts/platform/flags.sh` owns `parse_command_flags`. Each recovery target
opts in to `--file` with `COMMAND_ALLOW_FILE=1` and declares its accepted
`COMMAND_FACILITIES`; comment commands accept neither option. The same module
owns the document-input reader and the atomic export-file write. A value-taking
option followed by another option is a usage error.

The commands run from the repository root. Promotion and tombstone also read
`PROMOTION_PR_REF` or `TOMBSTONE_PR_REF`; unpromotion requires
`ID=<comment-id>`. This is the comment's internal UUID v5. Unpromotion removes the archive entry when present and the
D1 row when present; an id absent from both stores fails. Its preview reports
each location, the entry's author and first line, and the D1 action. Make
wrappers pass `APPLY=1` as `--apply` and otherwise pass `--dry-run`.

The JavaScript builders emit SQLite statements. A target implementation must
therefore speak SQLite when it executes those statements and pass normalized
`{"rows": [...]}` input to the host-free logic.

Recovery entry points follow the same boundary. A target that implements a
facility provides `export.sh` and `import.sh`; the Makefile selects them with
`DEPLOY_TARGET`. Node accepts `--facility records|sqlite` (default `records`);
Cloudflare accepts `--facility d1` (its default). Make forwards `FACILITY`.
They accept
`--dry-run`, `--apply`, and `--help`, default to a
preview, and reject both state flags together. Export prints a versioned
`blogu-recovery` document. Import validates the complete document before it
starts its facility transaction, and the target reports a non-zero failure
without silently skipping a declared layer. The node records facility uses
file access to `AP_DATA_DIR` as its credential. Its bash entry point and the
small node reader in `scripts/platform/node/records.mjs` exchange one JSON
snapshot (`{ document?, existing, existingReason?, records: [...] }`) and one JSON write plan with the
host-free adapter. Export requires `AP_DATA_DIR` to exist. An import destination
is non-empty when `AP_DATA_DIR` contains any entry; import requires an empty or
absent destination whose parent exists, and refuses a missing parent.
It stages every record in a complete sibling directory and commits that
directory with one rename, so a crash leaves the old empty or absent
destination or the new complete destination.

`scripts/platform/recovery.sh` owns the common snapshot → adapter →
validate/apply pipeline. A target supplies `recovery_reader` and
`recovery_adapter`. Import obtains the store snapshot, adds the input document
with the shared reader, and sends the complete plan to the target's
`--validate-plan` or `--apply-plan` path. Export prints the document after any
requested atomic file write succeeds. A killed file write can leave a private
`.blogu-recovery-export.*` sibling for the operator to inspect.

The reader's `--snapshot` status is part of this protocol: `0` means a complete
snapshot, and `3` means a complete snapshot with failed temporary-file cleanup.
Other non-zero statuses are fatal and stop the command before adapter or write
work. The shell accepts a status-`3` snapshot for normal validation and the
requested export or import operation, then exits `1` after printing its result.
Export with `--apply --file` still publishes the document. Cleanup diagnostics
name the leftover directory on stderr; they are not parsed as a status signal.
The import reader's final `--apply-plan` call continues to use status `1` for
an acknowledged import whose cleanup failed, with its applied result on stdout.

The node SQLite facility uses file access to `AP_DB_URL` as its credential;
the default is `AP_DATA_DIR/interactions.sqlite`. Its reader is
`scripts/platform/node/sqlite.mjs`, and its host-free adapter is
`scripts/recovery-sql.mjs`. Export exchanges `{ existing, sql: [{ kind, layer, rows }] }`;
import exchanges `{ document, existing }` and a plan of
`{ action: "insert", kind, layer, rows }` writes. All rows use logical register
columns. Both facility adapters use `scripts/recovery-plan.mjs` for complete
document validation, refusal of non-empty stores, and in-memory planning.
Its shared `runRecoveryAdapter({ exportFn, importFn })` requires an object and
a boolean `existing` for either operation, and `document` for import; omission
never implies an empty destination. Its sibling
`runRecoveryReader({ label, snapshot, prepare, apply })` owns reader mode
dispatch, stdin parsing and JSON stdout. It requires exactly one of
`--snapshot`, `--validate-plan` or `--apply-plan` before any input or store
read. All three target readers use it; the shell callers and output shapes
are shared. The records reader reports the path and reason when the
destination is non-empty.

`sqlSnapshotStatements`, `sqlInsertStatements`, `sqlClearStatements` and
`sqlUserSchemaStatement` in `scripts/recovery-sql.mjs` emit `{ sql, parameters }`
(with `kind` and `layer` for registered data). The node reader executes them;
other SQLite facilities can reuse the same aliases, bindings and conversions.
`src/lib/recovery.ts` owns identifier quoting. `scripts/run-cli.mjs` owns main
module detection and the shared stack-to-stderr / exit-code-1 failure contract.

`sqlUserSchemaStatement` accepts excluded prefixes and exact names. Node ignores
`sqlite_*`; D1 also ignores `_cf_*` and the exact `d1_migrations` name.
`validateSqlPlan` supplies complete plan validation to both SQL readers.

SQLite export requires an existing database with every selected table. Import
requires an absent or schema-less file and an existing parent; any user schema
or SQLite sidecar refuses it. Preview validates constraints in memory. Apply
builds and closes a complete sibling database using the runtime migrations,
then commits it with one rename. Stop writers throughout the move. See
`docs/recovery.md` for credentials, the SOPs, and crash recovery steps.

The Cloudflare D1 reader is `scripts/platform/cloudflare/d1.mjs`. Its credential
is an owner-held account API token with D1 Read for export and D1 Write for
import, or a Wrangler login. `CF_D1_ID` selects the database and
`CLOUDFLARE_ACCOUNT_ID` selects the account; `CLOUDFLARE_API_TOKEN` supplies a
token. It uses a private temporary D1-only Wrangler config, without changing
the site's generated config. It exchanges the same SQL snapshots and plans as
node SQLite and uses the same host-free adapter. Help requires no credential.

D1 import requires a database without user schema. Preview validates the whole
document and plan; D1 checks constraints only during apply. The reader submits
one SQL-file import, with a schema guard, the runtime's schema bootstrap and
all selected inserts. Wrangler has no CLI binding option, so this transport
renders the shared bound parameters as SQL literals (strings use UTF-8 hex).
D1's server-side import is the rollback boundary. No node staging database,
type round-trip preflight or cross-store transaction is claimed. A lost
acknowledgement is reported as unconfirmed and never automatically retried.
Stop writers throughout the move and verify with an exported byte comparison.
The shell tests use fake `npx` and temporary SQLite files; the owner-run D1
rehearsal remains unchecked in `docs/recovery.md`.
