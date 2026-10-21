# 0016. Data declares where it lives, in one register

Status: accepted
Date: 2026-10-11
Revised: 2026-10-21

## Context

The next step for the site is to let a logged-in owner do on the site what
today are local commands: promote a comment (`make promote`), write a note
(`make po`), pin a post (`make pin`). Login exists; no route yet changes owner
data. Each of these changes data whose durable form is in git. The runtime
holds no git credential, and the static profile has no runtime at all, so such
a change has to reach git some other way, and whatever carries it there has to
know where the data is.

At the time, where each kind of data lived was written down in several places,
none of which saw the whole: loader paths in `content.config.ts`, tables in the
SQL schema, record keys as string literals in the code using them
(`ap:followers`, `auth:session:<id>`), and the tombstone workflow's own SQL.
Comments already worked in two layers: promoted text in git, withdrawals in
SQL applied on top when a full-profile page reads them (0014), with a weekly
pull request carrying the withdrawals into git.

The discussion, the initial register and the questions left to implementation
are in issue #45.

## Decision

**Each kind of data declares where it lives, in one register.** The register is
standard JSON, so any tool can read it; a typed module validates and exports it
for the site. It lists everything an instance is made of — content, runtime
state, configuration, deployment material — so one file answers what a move or
a backup must carry. Secrets and accounts outside the repository appear by name
only.

**Layers, not rival copies.** A kind of data may have a base, usually git, and a
delta in a runtime store on top of it. A reader sees the base with the delta
applied. A **write-back** job reads the register and opens a pull request that
writes the delta into the base; the runtime record is kept and counts as written
back only once that pull request has merged. Being written back does not stop
a reader applying the delta: a reader keeps applying it until the base that
reader was deployed from includes the change, so nothing disappears between a
merge and the deploy that follows it. If the base moved meanwhile, a person
resolves the conflict in the pull request. Promotion is a selective write-back.

**Each entry carries what tools select by**: its layers (store kind and place,
never the host product), the write-back operations that apply, whose data it is
(`owner`, `others`, `system`), what a move does with it, and what it serves. A move carries `keep` data **as a portable export**, importable into any
supported store; secrets and external accounts are `owner-held`, carried by the
owner outside any export.

**Once a kind of data is registered, code within one runtime takes its location
from the register and from nowhere else.** An entry may go unread; a second copy
of a key or path may not exist. `content.config.ts` registers each collection
with the schema its content kind's model provides, through a selector
([0018](0018-src-is-layered-by-role.md)). It takes its loader paths from the
register.

## Rejected

**Write-through to git: the runtime opens a pull request for every change.**
The Worker would hold a token that can write the repository, widening what a
compromised runtime reaches from the site's data to its source.

**An export endpoint that the write-back job calls.** The server would decide
what is exported and from where. The data should declare that; a job that reads
the register can reach the stores on any host, and the endpoint would need a
credential of its own.

**Registering only data that has a runtime copy.** Loader paths would stay in
`content.config.ts`, git-only content and configuration would be missing from
the list, and what an instance consists of would again take several files to
answer.

**Collection schemas kept in `content.config.ts`.** Dropped by
[0018](0018-src-is-layered-by-role.md): a collection's schema is model-level.
The model provides it, a selector exposes it, and `content.config.ts` registers
it.

**A host's own backup as the unit of a move.** A store dump says nothing about
which registered data it holds, how entries refer to each other, or how to
import it elsewhere, so it is not the instance's migration format. Exports
describe the registered data and restore on every supported store. A SQL dump
can be one part of that, if its schema version and import behaviour meet the
same requirement.

## Consequences

- Moving a kind of data between stores is a change to its register entry and,
  if the store kind changes, to the code that reads it — not a search for string
  literals.
- The register is adopted kind by kind. A kind not yet registered keeps its
  location in its own code until it is, and existing jobs are brought to the
  write-back rule (completion only after merge) as they are moved onto the
  register.
- A write-back job runs outside the site and reads runtime stores from there,
  which needs host-specific access. That access is deployment tooling, like the
  wrangler configuration, not part of the site.
- Every store kind that holds `keep` data needs a versioned export format, so
  that "portable" cannot quietly become a dump of D1, SQLite or a host's KV; a
  store that cannot be exported that way cannot hold `keep` data.
- A conflict between a pending delta and a moved base is resolved by hand, so a
  write-back can wait on a person.
