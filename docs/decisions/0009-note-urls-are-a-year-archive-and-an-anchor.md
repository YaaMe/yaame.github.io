# 0009. A note's address is a year archive and an anchor

Status: accepted
Date: 2026-09-20

## Context

A note is published to the site and delivered to the followers. Its
ActivityStreams object carries two addresses that mean different things: `id`
is the object's identity and lives with the actor, `url` is the page a person
reads. Until now notes had no `url` at all, so a follower saw the content in
Mastodon with no way back.

Whatever `url` becomes is copied into every receiving server's database at
delivery. It cannot be corrected later — a correction only reaches servers
that re-fetch, and nothing obliges them to.

So the question is not which address reads best today. It is which address can
be promised.

## Decision

`/notes/{year}/#{id}`, where `{year}` is the archive file the note lives in.

`/notes/` is an unpaginated stream of the most recent notes, free to change
shape because no published address points into it.

## Rejected

**A page per note, `/notes/{id}/`.** The most durable address, and the reason
it was not taken is editorial rather than technical: a page holding one
sentence is a worse place to arrive than the same sentence among its
neighbours. Worth revisiting if notes ever grow long enough to stand alone.

**A single stream with anchors, `/notes/#{id}`.** Correct until the stream
needs paginating, at which point every anchor past the first page silently
stops resolving — and by then the addresses are in other people's databases.
The failure arrives long after the decision, which is what makes it the
dangerous option rather than merely the wrong one.

## Consequences

- Appending to a year is safe; moving anything already in one is not. A note
  may never be renumbered, re-dated into another archive, or paginated within
  its year.
- The archive year comes from the filename, never from `published`. Deriving
  it from the timestamp would put a note written just after local midnight on
  1 January into the previous year, because the stored timestamp is UTC — a
  permalink that breaks for one note a year, silently.
- `/notes/` may be redesigned, paginated or reordered freely.
- Adding `url` to an already-delivered note changes the digest that
  `announceEdits` keeps, so an `Update{Note}` goes out. That is correct: the
  object did change.
