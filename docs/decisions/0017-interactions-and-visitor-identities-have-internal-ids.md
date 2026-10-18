# 0017. Interactions and visitor identities have internal ids

Status: accepted
Date: 2026-10-19

## Context

Comments and reactions need identities that work across sources. Federation
supplies URLs; comments from users signed in through GitHub need an identity
independent of those URLs. Redelivery and a retried submission must identify
the same record. The source and the authenticated author must both take part
in that identity.

At approval, the interaction stores held only disposable test data. The owner
chose to change the identity model before real interactions needed conversion.
The approved proposal and its discussion are in issue #68.

## Decision

**The site assigns comments, reactions and visitor identities internal UUID v5
ids from stored inputs under one fixed site namespace.** UUID is the default
for keys; an exception needs a stated reason and an owner decision.

An identity's inputs are its source and identifier: the actor URL for
ActivityPub, or the numeric user id for GitHub. A federated interaction's
inputs are its source, the signing actor URL and the activity id. A GitHub
comment's inputs are its source, the numeric user id and a UUID generated when
the browser opens the comment form. A retry keeps those inputs. A new comment
gets a new form UUID.

Every input is stored. Every write path checks that the inputs compute the
stored id, including git validation and recovery imports through raw SQL.
The namespace, source names and input normalisation are defined once as
constants in `src/lib/interactions/key-scheme.ts`. That module is
authoritative; this record names it without copying the values. Changing them requires a migration that
recomputes ids in SQL and git together. These ids stay in storage, recovery
exports and local commands; they do not become public page or protocol
identifiers.

Visitor identities record authorship within a source, separately from login
and roles. Their computed primary key makes each source and identifier pair
unique, including concurrent first deliveries. Identities from different
sources are never merged automatically. A GitHub identity is the numeric user
id, never the login, as [0010](0010-a-session-is-not-a-privilege.md) requires.

Federated URLs are attributes present exactly on federated records. Comments
retain the activity and object URLs; reactions retain the activity URL.
These attributes support protocol matching and reference resolution. They
and ActivityPub actor URLs must be HTTP(S). On receipt, each activity URL and
a comment's object URL must share the signing actor's origin. A `Delete`
matches the comment's object URL and author; an `Undo` requires the reaction's
author as signer.

A comment's `root` and a reaction's `target` hold the site's content identifier.
For posts, this is the written `slug`, or the file name when no slug is written.
For notes, it is the note id. A comment's `replyTo` holds the parent comment's
internal id, or null for a reply to the root. Receipt accepts a comment only
when its parent is the site's content or a stored comment. Reactions target
only the site's content. Internal ids and content references follow their own
formats rather than URL validation.

## Rejected

**The sender's URLs as primary keys.** Uniqueness would rest on values chosen
by the sender. A source without a URL, such as a signed-in GitHub user, would
have no key to store.

**A site URL minted for each comment as its id.** An id is not a URL.

**A string identity key made from the source and external identifier.** This
is an external identifier, not the site's own id.

**An id computed from activityId alone.** It derives identity from a value the
sender chose, so another actor can produce the same id; and a comment from a
signed-in user has no activityId.

**A random UUID v4 for every key.** UUID v5 makes the primary key itself
idempotent for redelivery and retried submissions. The source and signer are
part of its inputs, and an import derives the same id without carrying a
mapping. The aim is a meaningless key, which UUID v5 also provides.

**A partial unique index on the federated columns.** The primary key is
computed from those inputs. Another uniqueness constraint would repeat it.

**A sequence for GitHub comments.** A sequence cannot recognise a retried
submission. It also reveals counts and order.

**The post's ActivityPub URL as a comment's root or a reaction's target.** The
URL combines the content identifier with the ActivityPub path. If that path
changes, stored references no longer match and nothing reports the mismatch.

**Root and target as a kind and slug pair, with a collision check.** Posts and
notes already share one identifier space, and the owner names them. A written
slug preserves a post's identity across a file rename, without adding a kind
to each reference.

**Ids that can never change.** Stored inputs let a migration recompute every
id. Keeping these ids out of public addresses and protocols makes that change
possible without breaking an external identity.

**Copying the identity constants into this record.** Two copies drift.

**Keeping the old tables so the migration cannot discard rows.** The owner
allowed drop-and-recreate. Safety comes from the check inside the migration,
atomic with the drop.

**A converter for older recovery exports.** The recovery format is beta until
the first formal release. It promises no compatibility between versions, so
a converter is not required.

## Consequences

- The primary key handles duplicate receipt and concurrent insertion. Writes
  rely on that constraint; a separate read before insertion cannot provide
  the same guarantee without row locks.
- SQL, promoted entries in git and recovery exports carry the same ids and
  their inputs. A promoted comment uses its comment id. Visitor identities
  become recoverable data, and the register remains the sole source of storage
  locations under decision 0016.
- Renaming a post file preserves identity only if its current identifier is
  first written as its slug. Changing a written slug or a note id changes a
  published identity. Note ids therefore retain their public-address
  obligations under decision 0009.
- A new migration replaces the interaction tables without converting rows;
  shipped migration SQL remains unchanged. This permission covers only the
  disposable rows the owner approved. The pre-deploy checks must confirm that
  approved data state in every store and the absence of promoted entries.
  The migration also checks each table when it runs. Its check and drop must
  be atomic against every writer and concurrent migration attempt. Any other
  row stops the drop and requires a person's decision.
- Recovery exports require a new format version. Imports reject older versions
  with a clear error. Until the first formal release, the beta format promises
  no compatibility between versions.
