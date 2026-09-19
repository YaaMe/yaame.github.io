# 0001. The outbox window is about the collection only, not about delivery

Status: accepted
Date: 2026-09-19

## Context

`AP.published` bounds how much of the archive the outbox collection offers.
ActivityPub leaves the number to the implementer: §5.1 says only that the outbox
holds what the actor published, and §6 that an activity "might appear after a
delay or disappear at any period". For an unauthenticated reader the
specification does say a server SHOULD return all public posts.

Two separate worries were once answered by this single value:

1. what an arbitrary reader, or a crawler, sees when it fetches the collection;
2. whether following the actor floods the follower with the entire back
   catalogue at once.

## Decision

`AP.published = 0` — the collection offers everything.

The value answers the first question only. Delivery keeps its own record of what
it has already sent, so the second question is answered there and not here.

## Rejected

**Bounding the collection to hold back the back catalogue.** This was the
earlier setting, and it works only by accident: it starves delivery by starving
every reader, including the unauthenticated one the specification asks to be
served in full. Once delivery tracks its own sends, the accident has no purpose
left, and keeping it would mean a crawler and a new follower are both limited
because of a constraint that applies to neither.

The rejection stays load-bearing while delivery keeps that record. If delivery
ever stops tracking what it has sent, this value is not the place to compensate
— fix delivery.

## Consequences

- An unauthenticated fetch of the outbox returns the whole public archive, which
  is what the specification asks for.
- The number in NodeInfo's `localPosts` reports what the outbox publishes, so
  with a window of 0 it and the archive agree. Under any other window they would
  not, and reporting the archive's size while the outbox offers less would
  describe two different servers.
- Changing this value now affects readers only. It is not a safety valve for
  delivery and must not be used as one.
