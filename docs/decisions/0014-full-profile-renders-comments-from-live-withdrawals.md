# 0014. Full-profile comments use a deferred server island

Status: accepted
Date: 2026-10-11

## Context

Promoted comment text is durable git content, while a `Delete` arrives in the
platform database first. A page that is built only from the content collection
cannot stop serving that text until a tombstone change is merged and deployed.
The full profile has the database available, but it must keep the site's pages
prerendered and the static profile must remain usable on a file host.

## Decision

Both profiles keep post and note-year routes prerendered. A build-time alias
selects the comment view, just as it selects the session bar:

- `static` renders the promoted content collection inline and applies the
  fixed-point withdrawal rule using the state already recorded in git. It has
  no database import in its module graph.
- `full` leaves a deferred server island in each post page. The island reads
  the promoted content collection, asks the platform database for withdrawn
  ids for that thread, applies the same fixed-point rule, and renders the
  comment section. Its response sends `Cache-Control: private, no-store`,
  because a shared cache must not outlive a withdrawal.

The full note-year page keeps its notes and permalink anchors prerendered, with
one empty keyed slot below each note. One deferred island returns only the
loaded comment sections for the year; a small inline script moves each section
into its slot. A page with many notes therefore makes one island request rather
than one request per note. `/notes/` stays comment-free. A post page also makes
one comment-island request. The pending fallback has
`data-comments-state="pending"`; an empty loaded response keeps a hidden
`data-comments-state="loaded"` marker, so the two states remain observable
without exposing comment text in the prerendered HTML.

## Rejected

**Whole-site server output.** Making `output: "server"` route every page
through the Worker would give the withdrawal query a simple page boundary, but
it would abandon the static output guarantee for the full profile and add a
Worker request to every page. The comment island gives the database boundary
only where it is needed.

**A browser request that removes comments after load.** It would leave
withdrawn text in the initial HTML and expose it before the second request
finished. It would also put a server-owned view's consistency rule in client
code.

**A database-backed static profile.** That profile is intended to run from
files on any host. Giving it a database would make the two profiles the same
deployment with a switch and would break that guarantee.

## Consequences

- A withdrawn promoted comment disappears from the full comment island as soon
  as the inbox records the `Delete`; the archive can wait for the weekly
  tombstone pull request.
- Full-profile comment sections need JavaScript to load and are mostly absent
  from crawler-visible HTML. The pending marker is present, but comment text is
  not.
- The static profile shows the git view until the next deploy after the
  tombstone change is merged.
- Each full post or note-year page makes one comment-island request. The note
  island batches withdrawal lookup for the page's root ids in chunks of 100,
  then returns only comment sections; the prerendered note DOM is untouched.
- Both profiles apply the same fixed-point rule, so a withdrawn parent whose
  only reply is also withdrawn disappears without waiting for the archive
  rewrite.
