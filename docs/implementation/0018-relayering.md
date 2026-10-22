# ADR 0018 implementation: final boundary audit

Step 17 of [the approved plan](../proposals/relayering.md#17-audit-final-boundaries-and-align-documentation),
issue #88 task 8, starts from `592432a` on `relayer/t8-wiring`.
That revision contains reviewed step 16. ADR 0018 and the proposal remain unchanged.
This record describes the implementation and its checks; review verdicts are on
issue #88, and nothing here records a deployment.

## Changes and audit findings

The audit searched the 57 source paths removed during steps 1–16, plus the two
old generated register paths. It included extensionless and relative spellings,
imports and exports, bundle entries, copied fixtures, Makefile targets, shell
scripts, workflows, checkers, generated declarations, Astro frontmatter and aliases.

Remaining old spellings are historical evidence in the approved proposal or
negative mutation inputs in `tests/tombstones-workflow.test.mjs`. Those tests
verify that consumers reject the old generated-register location. No live old
module reference was found in the inspected files.

Removed `parsePostFilename` from the authoring service's exports and removed the
test that existed only for that forward. Step 14 replaced command callers with
`preparePost` and `prepareFrontmatter`; the service still uses the model internally.
Model grammar tests, authoring behavior tests and plain-Node import tests remain.
The intentional object and collection selector forwards remain, as does the narrow
object-id forward used by build configuration. `scripts/ap-check.mjs` remains an
independent live probe.

The inspected library helpers import no application band. Selectors import no
services and contain no direct store writes. Services import no entrance schemas,
params or routes. Views reach data through the middle band; both profiles' alias
targets remain components. The inspected operational commands delegate application
rules to services/selectors. Their remaining checks concern command input, files,
connections, execution or summaries. Recovery uses the host adapters allowed by O8.

The static audit could not resolve eleven generated test import sites: in-memory
bundles, a temporary inbox bundle, copied command modules and subprocess import
loops. It also cannot resolve arbitrary future build output paths, operator-selected
host paths or changed register destinations. The Makefile also selects three
missing Node scripts: `scripts/platform/node/promote.sh`,
`scripts/platform/node/unpromote.sh` and `scripts/platform/node/tombstone.sh`.
Their Cloudflare counterparts exist. Adding Node implementations requires separate
work; the audit makes no coverage claim for those missing paths. The local report
lists each site and the concrete cases inspected. Passing tests/builds cover their
exercised cases only.
The audit is a self-check under O7; Makefile and CI do not run it as a gate.

The current architecture, configuration, interaction and recovery documents now
describe the tree. The [selector inventory](../architecture.md#the-rule) includes
all 23 modules and their exported values and types. `CLAUDE.md` keeps its rules;
its factual corrections identify Markdown/JSON content and the host-specific
operational readers that call host-neutral application logic.

## Read-path status (B13)

One known boundary violation remains: SQL-backed selector reads reach
`src/persistence/interactions/database.ts`, where `store()` calls `migrate(db)`
on first access. B13 owns removing schema initialization from requests. A removal
alone would break first-access behavior, so step 17 records this violation without
changing it. The audit found no other boundary violation in its inspected scope.
It does not claim complete read purity or prove that no application-rule copy
exists elsewhere.

## Retention and fingerprints

| Policy | Current implementation and limit |
| --- | --- |
| Withdrawal | `src/persistence/interactions/write-comment.ts` clears SQL text and records withdrawal. The re-layering adds no hidden text archive. |
| Unpromotion | `src/services/interactions/unpromote.ts` plans removal of the archive entry and SQL row. The operation writes the archive before requesting SQL deletion. |
| Sessions | `src/services/auth/session.ts` expires or revokes credentials. Record persistence supplies TTL; recovery excludes sessions. |
| Diagnostics | `src/persistence/records/departures.ts` retains at most 50 entries. The register marks departures and delivery failures for reset. |
| Recovery | Version 4 and the register's selections remain: export keep kinds; exclude rebuild, reset, ephemeral and none kinds; list owner-held inputs without values. |
| Fingerprints | Actor and content signals compare derived digests and write checkpoints before sending. Recovery keeps note digests and omits the actor digest as `rebuild`. |

Fingerprints have historical significance: current content alone cannot reconstruct
a previous checkpoint after the fingerprinted fields change. Digest records retain
no source representation or delivery outcome. They prove neither remote receipt
nor a lossless source history. ADR 0003's announcement rule remains the explicit
exception to raw-only control inputs. O12 preserves that policy. Stronger provenance,
recovery or retry guarantees require the separate B10 change; none is added here.

## GET triggers (O15)

O15 leaves GET-trigger policy to the features that need it. This migration preserves
actor announcements, outbox publication/following reconciliation/content updates,
and expired-session cleanup at their existing entrances, with the existing await
order. It does not select new triggers or broaden permission for GET writes.

## Open decisions

No new owner decision is needed for step 17. O6's promotion-filter interface and
O14's replacement login-failure display remain undecided. B1's failure behavior is
feature-specific; B1–B13 remain separate behavior work. The temporary login page,
component and selector remain until B11/O14, as the plan requires.

## Validation

Initial step 17 validation, before the structure-review follow-up:

| Command | Result |
| --- | --- |
| `make test` | Passed: 509 pass, zero fail, one existing TODO |
| `BUILD_PROFILE=full DEPLOY_TARGET=cloudflare make check` | Passed: types, build, 509 passing tests and links |
| `make build-consumer` | Passed: Wrangler deployment dry run |
| `BUILD_PROFILE=full DEPLOY_TARGET=node AP_DATA_DIR=<scratch> make build` | Passed |
| `BUILD_PROFILE=static DEPLOY_TARGET=node make build` | Passed |
| `BUILD_PROFILE=static DEPLOY_TARGET=cloudflare make check` | Passed: types, build, 509 passing tests and links |

All six commands ran in order after the initial executable edits. Both
Cloudflare type checks reported zero errors and warnings, with one existing hint.
Static Cloudflare ran last and left static output in `dist/`. `git diff --check`
also passed. The test count fell by one because the removed test covered only the
obsolete forward.

Tooling uses polling and npm offline mode; no package is installed or updated. No live probe, remote recovery or deployment is part of
these checks.

## Structure-review follow-up

The supplied structure review returned NOTES. This record now owns the B13,
retention/fingerprint and O15 statements; architecture, interactions and recovery
link here. The configuration selector exports only `OBJECT_PATH_TEMPLATE`.
The O1 object selector preserves every export and forwards the scheme directly
from its model.

After these executable edits, `make test` passed: 509 pass, zero fail, one existing
TODO. Plain-Node imports passed for both selectors without virtual aliases.
The configuration selector also loaded no Fedify constructor graph. The checks
confirmed its single export and the O1 selector's unchanged exports. The full
acceptance matrix was rerun after these edits, in the order above, and passed
with 509 tests.
