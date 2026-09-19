# 0003. The actor announces itself when it is built, not on a timer

Status: accepted
Date: 2026-09-19

## Context

Nothing re-reads an actor because we edited it. Mastodon refreshes a remote
account lazily, on the order of a day, and what it stored at first fetch keeps
deciding things long after: the avatar it shows, whether the account is
discoverable, whether the follower list is hidden at all.

The same holds for delivery. A post is sent to the followers once; there is no
second party asking whether anything is pending.

So both need a trigger, and the question is what that trigger is.

## Decision

Both run inside the dispatcher that builds the document: the actor compares its
fingerprint and sends an `Update` when it moves, and the outbox sends whatever
has not been delivered.

A document that has been built is the moment the change becomes a fact. In
practice the fetch that triggers it after every deploy is `scripts/ap-check.mjs`,
which reads both.

## Rejected

**A timer.** "The actor changed" is not a state that needs polling for — it has
an exact moment, and a scheduled job can only discover it late. A timer is also
a second mechanism to keep working: one more credential, one more thing that can
be silently not running, and nothing reports a cron that stopped firing.

Running it in the dispatcher also makes a manual announcement a plain `GET` of
the actor, with nothing to invoke.

**Announcing on every deploy.** This would push a message to every follower's
server for builds that changed nothing here, so the actor document and each
delivered note are fingerprinted instead.

## Consequences

- An actor nobody fetches is never announced. This is acceptable: the followers'
  servers fetch it, and a change nobody ever reads costs nothing to leave unsent.
- Both paths write their record *before* sending. A failed delivery is therefore
  not retried, which is the deliberate trade against announcing on every fetch
  until one succeeds.
- The conformance check is load-bearing beyond checking conformance. If it is
  ever removed from the deploy, delivery loses its trigger.
