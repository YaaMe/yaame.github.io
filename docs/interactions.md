# Interactions: notes, comments, likes

This document describes how interactions work now, and the constraints they
run under. It covers what arrives from outside (replies, boosts, likes), the
notes we publish ourselves, and how both move between runtime storage and git.
Long posts are out of scope. They are always in git.

Where a record in [`decisions/`](decisions/) covers a choice, this document
links to it. Some rejected options are argued here because no record covers
them yet.

## Two layers

```
git              The durable layer and the single source of truth.
                 Reviewable, revertible, indexed at build time.
runtime storage  What arrived from outside and is not in git. Disposable.
commands         Carry chosen runtime records into git.
```

The split makes keeping something an explicit decision. By default nothing
enters git. A person chose every record that is in git.

Only comments cross from runtime storage into git. Notes go straight into git:
`make po` appends a note to `src/content/notes/<year>.json`. No route writes a
note to the database.

## Storage: one SQL dialect

| | On Workers | On node |
|---|---|---|
| Driver | D1 (first-party binding) | built-in `node:sqlite`, no dependency |
| Above it | Drizzle, one set of table definitions for both drivers | same |

The table definitions are in `src/integrations/activitypub/store/schema.ts`.
Why Drizzle, and why not KV, a document store or hand-written SQL: see
[0007](decisions/0007-interactions-live-in-a-database-the-host-provides.md).
In the bundle Drizzle is 167 KiB (3.2%). Fedify is 72%.

SQLite was not chosen for being better. The constraints left nothing else:

- **Postgres, MySQL, Mongo, Firestore.** Workers have no local implementation
  of any of them, so each one means an external service. That brings in a
  third party and a connection secret. The data then lives with someone else,
  so it cannot be moved freely either.
- **Durable Objects.** No third party, but node has no equivalent, so this
  closes the path to another host. It is the same trade as keeping the signing
  key in a GitHub secret as well as in Cloudflare.
- **KV.** See below.

For an embedded, single-file, serverless store, SQLite is the only mature
option with both atomic transactions and queries. Plain JSON has no indexes
and no atomic updates. That is enough at the size of the follower list, which
is held as one JSON value in KV. LMDB and LevelDB have no queries, and Workers
have no equivalent. DuckDB is built for analytics, which is the wrong shape.

### Why comments cannot live in KV

Volume is not the problem. KV's guarantees are:

| Limit | Consequence |
|---|---|
| One write per second per key, on every plan | A like count is read-modify-write. Two at once lose one. A paid plan does not change this |
| No atomic operations | Same, and no transaction can repair it |
| Eventually consistent, up to 60 seconds | A received comment cannot show at once |
| 1,000 writes a day on the free plan, across all keys | A hard ceiling |
| Listing by key prefix only | One more filter dimension is too many |

KV keeps small state that is written rarely: the follower list, the actor
digest, the delivery record and login sessions.

### Keeping a move to another database cheap

The database does little on purpose. It appends a row, reads rows back by one
or two keys, counts rows, and marks a row deleted or undone. There are no
joins, no full-text search and no vendor functions. To move to Postgres,
switch to Drizzle's postgres driver and keep most of the table definitions.

Safeguards:

- **Times are ISO 8601 strings.** SQLite has no date type, and every dialect
  reads an ISO string the same way. A numeric timestamp is smaller, but every
  reader would have to decode it by hand.
- **Application code holds no SQL text.** Queries are builder calls, and
  Drizzle renders the dialect.

Exceptions to the second rule:

- The migrations in `schema.ts` are hand-written SQL.
- `scripts/promote.mjs` and `scripts/tombstone.mjs` send SQL text to D1
  through `wrangler d1 execute`. They work against D1 only.

## Search stays out of the database

All text that needs full-text search is on the git side. Long posts are there
already, and promoted comments arrive there. So search indexes git at build
time and does not query the database at runtime. No search exists yet:
`features.search` is `false` in both profiles.

This removes a requirement. It also avoids a measured problem:

```
FTS5 unicode61   no Chinese query of any length matches
FTS5 trigram     3 or more characters match; 2 or fewer return nothing
```

D1 and `node:sqlite` both ship FTS5 and json1. Their default tokenizers do not
segment Chinese, and neither has the ICU tokenizer. At build time the choice of
tokenizer and dependencies is free.

## Comments

### Store everything, promote selectively

Putting a stranger's words into a public repository cannot be undone. Git is
permanent, indexed and readable by anyone. The author did not know their words
would land there.

The inbox stores every reply to one of our posts or notes. `make promote` then
carries a chosen subset into `src/content/comments/`. It is a dry run unless
`APPLY=1` is set. With `APPLY=1` it writes the files, then sets `promoted_at`
on each row in D1. It never promotes a row that is already deleted.

The filter receives a whole thread, because judging a comment needs its
context. "Keep the whole reply chain" cannot be expressed one comment at a
time. `scripts/promote-filter.mjs` default-exports the rule:

```js
export default (thread) => keptComments;
```

That file provides `byAuthor`, `wholeThread` and `nothing`. The default is
`nothing`, so no comment is promoted until someone writes a rule. Choosing
what to keep is a social judgement, not a data-structure question, so the
unit of selection is not fixed.

Promotion stores the comment as text, not as the sender's HTML. See
[0006](decisions/0006-promoted-comments-are-stored-as-text.md). It also
fetches the author's display name and stores it as `name`.

### What the specification requires

**De-duplication is a MUST.** ActivityPub §5.2 requires a server to
de-duplicate by activity `id`. The activity id is the primary key of the
comments table, so the database refuses a redelivery.

**On `Delete`, the server SHOULD remove the object.** §7.4 is a SHOULD, and
the specification says the protocol cannot force a remote server to delete
anything. A server MAY replace the object with a `Tombstone`. The inbox
accepts a `Delete` only for an object whose author sent it.

**Retention has no constraint.** §7.2 says only that a server is likely to want
a local copy. That is an expectation, not a requirement. So expiry is a
product decision. Comments do not expire.

### Deletion

A comment that is in git cannot be removed from it at runtime. Deletion happens
in two places, at two times.

When a `Delete` arrives for a comment:

1. The inbox sets `deleted_at` and empties `content` in the database. The row
   stays.
2. From that moment the post's `replies` collection and every reply count leave
   the comment out. This meets §7.4 for what we serve over ActivityPub.
3. If the comment was not promoted, nothing else shows it, so nothing else
   changes.
4. If the comment was promoted, git still holds its text. Post pages are
   prerendered from git in both profiles. So the post page keeps showing the
   comment, in full.
5. The Tombstones workflow runs every Monday at 01:37 UTC, or when started by
   hand. It finds the rows where both `deleted_at` and `promoted_at` are set,
   rewrites `src/content/comments/`, and opens or updates a pull request.
6. A person decides whether to merge. A merge pushes to `main`, and that push
   rebuilds and redeploys both sites. Only then does the text leave the page.

So a withdrawn comment that was promoted stays on the page until the next run
of the workflow, a person's merge, and the deploy after it. Nothing at runtime
shortens that. Until the merge, we are still showing words their author asked
us to remove. How long depends on when someone next looks at GitHub.

No separate queue of pending removals exists. The pending set is the query on
the two columns.

When the workflow rewrites a file:

- A withdrawn comment that nothing replies to is removed. A file left empty is
  deleted.
- A withdrawn comment that another comment replies to loses its `content` and
  gains `deletedAt`. The page shows it as "已由作者删除 · <date>", so the reply
  below it still answers something.
- The rewrite repeats until nothing changes. Removing a reply can leave the
  tombstone above it with no replies, and that tombstone then goes too.

When the site is built, `commentsFor()` also hides a tombstone that nothing
replies to.

The rewrite does **not** change history. The commit is the record. The promise
was never that the comment did not exist. It is that the comment is gone now,
and the commit records that. The original text staying in history is
therefore not a defect.

This is one more reason to promote selectively. Each promoted comment from a
stranger is a deletion obligation we can only partly meet.

### A hard requirement on the stored format

Every promoted entry must carry its activity id. Without it, the workflow
cannot tell which entry to change. The `activityId` field is required in
`src/content.config.ts`.

### The pull-request job

`.github/workflows/tombstones.yml`:

- Runs weekly, and on `workflow_dispatch`.
- Does nothing when nothing is pending. It never opens an empty pull request.
- Is idempotent. Each run rebuilds the fixed branch `comments/tombstones`
  from `main` and force-pushes it, so one batch updates one open pull request.
  A hand edit on that branch is overwritten on the next run. Edit `main`
  instead. The force-push exception is explained in `CLAUDE.md`.
- Holds `GITHUB_TOKEN` with `contents: write` and `pull-requests: write`. No
  personal access token is needed, because opening a pull request is within
  that token's permissions.
- Holds `CLOUDFLARE_API_TOKEN` to read D1. That token has `D1 Read` and no D1
  write permission.

Only CI can do this. The runtime holds no GitHub token, deliberately. The
mirror also holds: CI cannot write D1, so `make promote` runs locally, under
your own login.

## The write entry point

A write through a route needs an authenticated identity. The site has its own
GitHub OAuth login, in `src/integrations/auth/`. It exists only in the `full`
profile. It serves `/login`, `/auth/github`, `/auth/github/callback` and
`/auth/logout`. Logout is `POST` only.

- **The scope is `read:user`, written out.** With an empty scope, GitHub
  reuses whatever the user granted before. What arrives would then depend on
  their history, not on what we asked for.
- **The allowlist decides permissions, not login.** Anyone can log in. The
  list decides what they may do after that. The tiers are owner,
  allowed and guest. The login page shows them as "站长", "名单内" and "访客".
  A GitHub login proves only that the visitor is some GitHub user, not that it
  is you. So no path may treat "has a session" as "is the owner". Every
  privileged path asks `roleOf()`. Identities are compared by numeric GitHub
  id, never by username. A username can be changed, and the old one is then
  free for anyone to take. See
  [0010](decisions/0010-a-session-is-not-a-privilege.md).
- **A session is an opaque id with a record in KV.** It is not a signed
  cookie. So there is one less secret to place by hand, and a session can be
  revoked. Sessions last 30 days. Logout deletes the record, not only the
  cookie.
- **The head bar reads identity on the server.** Its prerendered HTML contains
  only the empty structural placeholder. In the `full` profile a deferred server
  island reads the HttpOnly `session` cookie and its KV record, and its response
  is private and not shared-cached. The `static` profile aliases that component
  to an empty implementation. There is no separate display cookie.
- **The only secret placed by hand is `GITHUB_CLIENT_SECRET`.** The client id
  is public and is in `src/integrations/auth/config.ts`.

**Cloudflare Access is not used.** It needs less code here, though the Worker
would still have to verify its JWT. But that gate is state in the Cloudflare
dashboard. Git cannot see it, nobody can review it, and it is gone when the
site moves host.

**Nothing is behind the gate yet.** No route performs a write, and
`AUTH.allow` is empty. Today `roleOf()` decides only what `/login` displays.

## Likes and boosts

Likes and boosts share one table, because they differ only in the verb. They
have the same sender, the same target and the same undo. An undo **marks the
row and keeps it**. Deleting the row would let the same boost be counted again,
and the primary key exists to stop that.

We publish **counts only, never who**:

- The specification makes `likes` and `shares` a MAY. The duty to add to the
  collection on receipt applies only "if this collection is present".
- Mastodon does the same. Measured: it answers 404 for `/likes` and `/shares`,
  and puts the counts inline on the object.
- Who liked or boosted a post stays in the database and is not published. This
  is a decision, not an omission.

`replies` is the opposite: a real collection with an id, fetchable and paged.
A reply is public speech. A like is an action.

## Delivery

| | |
|---|---|
| How much the outbox shows | `AP.published`; `0` means everything |
| What goes to followers | `ap:delivered` records what was sent; only unsent posts go |
| First run | Records everything as sent and sends nothing. A new account must not flood every follower with the archive |
| A post changes | When its fingerprint changes, an `Update{Note}` goes out. The fingerprint covers the content, URL and date, **never the counts** |

The last row is deliberate. A push to every follower for every like would cost
their servers. Mastodon does not do it either: counts update when someone
fetches the object.

**An old post that is delivered does not reach anyone's timeline.** Mastodon
puts a post on the home timeline only if its `created_at` is within the last
6 hours. This stops backfill from flooding timelines. So the archive can be
found and opened, but it does not appear in timelines. That is correct, but
"delivered" and "seen" are different things.

## Rendering comments on the site

Post pages render promoted comments, in both profiles. `commentsFor(slug)` in
`src/lib/comments.ts` reads the `comments` content collection. It reads only
git, never the database. So the static site and the full site show the same
comments.

`src/components/Comments.astro` renders them under the heading "回应". Each
comment shows the author's name or `@name@host`, a date that links to the
original, and the text. The text is plain text (see
[0006](decisions/0006-promoted-comments-are-stored-as-text.md)). The template
escapes it. Blank lines separate paragraphs, and URLs become links with
`rel="nofollow ugc"`. There is no sanitiser and no `set:html`.

Limits as they stand:

- Only `/posts/{slug}/` renders comments. Note pages do not.
- `scripts/promote.mjs` writes every thread to
  `src/content/comments/posts/<id>.json`, including a thread under a note.
  Nothing writes `src/content/comments/notes/`.
- A withdrawn comment stays on the page until the tombstone pull request is
  merged and deployed. See [Deletion](#deletion).

## What has run, and what is only written

This distinction matters more than the list.

**Verified with real data:** Follow → Accept; delivering `Create`; storing an
inbound reply (thread placement, de-duplication); storing `Announce` and
`Like`; all three `Undo`s (unfollow, unboost, unlike); counts visible from
outside and back to zero after an undo; paging; the deletion chain through to
the tombstone pull request.

**In place but not verified:**

- Removing a follower on a permanent failure (404/410). The only sample was
  recorded by Fedify before the handler was deployed. Fedify now skips that
  inbox, so no event fires.
- `Update{Note}`. It fires only when a post's content actually changes.
- Timeline placement. It needs a new post dated now.

The last two will happen in the course of normal writing.

## Permissions of the CI token

`docs/cloudflare-token.tf` declares them. Each permission is listed with the
failure that appears without it:

| Permission | The failure without it |
|---|---|
| Workers Scripts Write | Nothing can be deployed |
| Workers KV Storage Write | The `AP_KV` binding |
| Queues Write | The producer and the consumer |
| Zone → Workers Routes Write | `Authentication error [code: 10000]`, on the zone side. Account-level Workers permissions do not reach it |
| D1 Read | `code: 7403` (the account is not authorised for this service), when the Tombstones job queries the database |

**Withheld on purpose:** `Memberships Read`. If wrangler needs to look up
memberships, the account id did not arrive, and the deploy should fail. With
that permission it would succeed, against an account nobody declared.

That file **has not been applied**. The token in use was created by hand.

## Pinned posts: `featured`

**Mastodon never backfills a remote outbox.** Nothing in its source reads one.
It records `outbox_url` and takes a post count from `totalItems`. So a stranger
who finds this account sees "N posts" and cannot list any of them. That is
normal behaviour, not a defect.

`featured` is the one exception. When `ProcessAccountService` processes an
actor that has this field, it fetches the collection. So it is **the only way a
new visitor sees content at once**, without following and without waiting for
a new post.

A post is pinned by `pinned: true` in its frontmatter. `make pin <slug>` and
`make unpin <slug>` edit that one line. The actor advertises `featured`, and
the collection serves every pinned long post. Notes cannot be pinned: a note
has no title, and pinning exists to tell a first-time visitor what is written
here.

## Status

- [x] Storage seam with two implementations, D1 and `node:sqlite`, through
      Drizzle
- [x] Schema: a comments table and a reactions table, keyed by activity id, so
      the database enforces the de-duplication the specification requires
- [x] `.on(Create)`: replies are stored
- [x] `.on(Delete)` tells an account deletion from an object deletion
- [x] `.on(Announce)` and `.on(Like)`, with their `Undo`
- [x] The `replies` collection; `likes` and `shares` counts
- [x] The promote command and its filter
- [x] Comments rendered on post pages
- [x] The weekly tombstone pull request
- [x] The `featured` collection
- [x] GitHub OAuth login and sessions
- [ ] A write route behind `roleOf()`
- [ ] Comments under notes: promoted to the posts path, rendered nowhere
- [ ] A withdrawn, promoted comment leaving the page before the pull request
      is merged
