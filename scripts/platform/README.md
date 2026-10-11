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
