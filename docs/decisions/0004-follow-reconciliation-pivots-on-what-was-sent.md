# 0004. Follow reconciliation pivots on what was sent, not on what was accepted

Status: accepted
Date: 2026-09-19

## Context

`src/integrations/activitypub/following.json` is the intent: the handles this
actor means to follow, edited by hand and committed. Something has to turn a
change there into a `Follow` or an `Undo`.

The obvious comparison is against `ap:following`, the set of actors that have
accepted. It is wrong.

## Decision

Reconcile against `ap:follow-intent` — the record of which handles we have sent
a `Follow` for, and which actor each resolved to.

|  | sent | not sent |
|---|---|---|
| **intended** | nothing | send `Follow` |
| **not intended** | send `Undo`, drop from `following` | nothing |

## Rejected

**Comparing against `ap:following`.** "Not in `following`" is three states
wearing one face: never sent, sent and waiting for an `Accept`, and sent and
rejected. The last two must not be re-sent, and the comparison cannot tell them
from the first — so every reconciliation pass re-sends a `Follow` to everyone
who has not answered, and to everyone who said no.

## Consequences

- The intent table doubles as the handle→actor resolution cache, so an intent
  deleted from git still says who the `Undo` goes to. Losing that key means
  losing the ability to unfollow anyone, and re-adding the handle to re-resolve
  it is the recovery.
- An `Accept` is only honoured if its actor appears in the intent table. A late
  `Accept` arriving after the `Undo` was sent is therefore ignored — without
  that guard `following` gains someone we do not follow, and reconciliation
  would never remove them, because its own record is already clean.
- Reconciliation can only run in the Worker: sending a `Follow` needs the
  signing key, which exists nowhere else. The mirror holds for the jobs that
  write git, which can only run in CI.
