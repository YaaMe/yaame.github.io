# 0005. The signing key is read, never generated

Status: accepted
Date: 2026-09-19

## Context

The actor's RSA key signs every outbound request and is published in the actor
document. Every follower's server stores a copy at first fetch and verifies
against it.

The key-pair dispatcher runs on a request. It reads `AP_KEY_JWK` from the
Worker's secrets, and has to decide what to do when that read comes back empty.

## Decision

Throw. The key is placed by hand, once; an absent one fails every request.

## Rejected

**Generating a key pair on a miss and storing it.** This is the shape most
tutorials use, and the convenience is real — a first deploy works with no
manual step.

It is also unable to tell a first run from a misconfigured binding or a single
failed read, because from inside the dispatcher those are the same empty value.
It answers all three by minting a new identity. Every existing follower is then
holding a key that no longer matches, their servers reject our signatures, and
nothing reports it: delivery is asynchronous, and a rejected signature is a log
line on someone else's machine.

The decision cannot be made correctly here, so it is not made here at all.

## Consequences

- A deploy with the secret unset fails loudly and immediately, which is the
  intent. `scripts/secrets.mjs` checks for it ahead of the deploy so the failure
  arrives before the Worker is replaced rather than after.
- Rotating the key is a deliberate act with a known cost: every follower must
  re-fetch the actor. There is no path that does it by accident.
- No automation may write this secret. Nothing in CI has it, and nothing in the
  repository can read it back — `wrangler secret put` is write-only.
