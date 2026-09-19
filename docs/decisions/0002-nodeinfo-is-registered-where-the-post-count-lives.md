# 0002. NodeInfo is registered where the post count lives

Status: accepted
Date: 2026-09-19

## Context

`/.well-known/nodeinfo` advertises a link to a NodeInfo document, and the
document reports usage counts. Federation wiring otherwise lives in
`federation.ts`, which is where a reader would look for a dispatcher.

The counts NodeInfo reports are not federation facts. `localPosts` is what the
outbox publishes, which comes from the content layer through `timeline()` and
the outbox window.

## Decision

The NodeInfo dispatcher is registered in `outbox.ts`, next to the timeline and
the window it reports on.

## Rejected

**Registering it in `federation.ts` with the other dispatchers.** Consistent by
location, but it would put the reported counts one import away from the thing
that determines them, and the two would drift the first time the window changed
without the report being revisited — silently, because nothing compares them.

Also rejected: **not registering it at all**, which is what happened before this
was noticed. `/.well-known/nodeinfo` answered with an empty list of links while
the route it would have pointed at returned 404 — a discovery document that
discovered nothing.

## Consequences

- A reader looking for federation dispatchers will not find this one in
  `federation.ts`. That cost is accepted; the alternative moves the drift risk
  onto the numbers themselves.
- `localPosts` and the outbox window change together because they are in the
  same file.
- The counts are deliberately modest about what this server does: `localComments`
  is 0 because nothing inbound is stored, and the version string stays `0.0.x`
  while the inbox still drops replies, boosts and likes. See ADR 0001 for why
  the window is what it is.
