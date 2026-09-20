# Decisions

Why a thing is the way it is, when the reason would otherwise be re-litigated.

A decision record exists for one reader: whoever is about to change this area
and does not know what was already weighed. Its load-bearing part is **the
rejected option and why the rejection still holds** — a record that only states
what was chosen saves nobody from re-proposing the alternative.

Nothing here describes how to use the code. That is `README.md` for a person and
the code itself for everyone. Nothing here is a constraint an agent must obey
every session — that is `CLAUDE.md`.

## When to write one

- A comment is growing into an argument. Move the argument here and leave the
  consequence in the code.
- A reviewer, or a future session, would reasonably propose the option that was
  already rejected.
- A value was set deliberately and looks arbitrary.

Not for: anything the code states plainly, or a choice nobody would question.

## Format

`NNNN-a-sentence-in-the-present-tense.md`, four sections:

```markdown
# NNNN. The decision, as a sentence

Status: accepted | superseded by NNNN
Date: YYYY-MM-DD

## Context

What made this a question. The constraint, not the history of the codebase.

## Decision

What holds now.

## Rejected

The option not taken, and why the rejection is still load-bearing. If this
section is empty the record is not worth keeping.

## Consequences

What is now true because of this — including what it costs.
```

Numbers are never reused. A superseded record keeps its number and gains a
pointer; the replacement says what changed and why the earlier reasoning no
longer holds.

`docs/identity.md` and `docs/interactions.md` predate this directory and stay
as they are. New decisions land here.

## Index

| # | Decision |
|---|---|
| [0001](0001-the-outbox-window-is-about-the-collection-only.md) | The outbox window is about the collection only, not about delivery |
| [0002](0002-nodeinfo-is-registered-where-the-post-count-lives.md) | NodeInfo is registered where the post count lives |
| [0003](0003-the-actor-announces-itself-when-it-is-built.md) | The actor announces itself when it is built, not on a timer |
| [0004](0004-follow-reconciliation-pivots-on-what-was-sent.md) | Follow reconciliation pivots on what was sent, not on what was accepted |
| [0005](0005-the-signing-key-is-read-never-generated.md) | The signing key is read, never generated |
| [0006](0006-promoted-comments-are-stored-as-text.md) | Promoted comments are stored as text, not as the sender's markup |
| [0007](0007-interactions-live-in-a-database-the-host-provides.md) | Interactions live in a database the host provides |
| [0008](0008-post-urls-carry-the-slug-alone.md) | Post URLs carry the slug alone |
| [0009](0009-note-urls-are-a-year-archive-and-an-anchor.md) | A note's address is a year archive and an anchor |
