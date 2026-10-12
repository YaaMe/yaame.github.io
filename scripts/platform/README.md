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

The commands run from the repository root. Promotion and tombstone also read
`PROMOTION_PR_REF` or `TOMBSTONE_PR_REF`; unpromotion requires
`ID=<activity-id>`. Unpromotion removes the archive entry when present and the
D1 row when present; an id absent from both stores fails. Its preview reports
each location, the entry's author and first line, and the D1 action. Make
wrappers pass `APPLY=1` as `--apply` and otherwise pass `--dry-run`.

The JavaScript builders emit SQLite statements. A target implementation must
therefore speak SQLite when it executes those statements and pass normalized
`{"rows": [...]}` input to the host-free logic.

Recovery entry points follow the same boundary. A target that implements a
facility provides `export.sh` and `import.sh`; the Makefile selects them with
`DEPLOY_TARGET`. They accept `--dry-run`, `--apply`, and `--help`, default to a
preview, and reject both state flags together. Export prints a versioned
`blogu-recovery` document. Import validates the complete document before it
starts its facility transaction, and the target reports a non-zero failure
without silently skipping a declared layer. The node records facility uses
file access to `AP_DATA_DIR` as its credential. Its bash entry point and the
small node reader in `scripts/platform/node/records.mjs` exchange one JSON
snapshot (`{ document?, records: [...] }`) and one JSON write plan with the
host-free adapter. Export requires `AP_DATA_DIR` to exist. An import destination
is non-empty when `AP_DATA_DIR` contains any entry; import requires an empty or
absent destination whose parent exists, and refuses a missing parent.
It stages every record in a complete sibling directory and commits that
directory with one rename, so a crash leaves the old empty or absent
destination or the new complete destination.
