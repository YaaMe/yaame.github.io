# 0010. A session says who you are, and nothing about what you may do

Status: accepted
Date: 2026-09-20

## Context

The routing layer needs an identity before it can accept a write. GitHub OAuth
supplies one, and `docs/interactions.md` had already settled the mechanism:
self-implemented rather than Cloudflare Access, `scope=read:user` stated
explicitly, an opaque session id with a KV record rather than a signed cookie.

What it left ambiguous is what the allowlist is for. Read one way it gates
logging in — a stranger is turned away at the door. That is not what is wanted:
anyone may log in, and the site is then simply a place where the reader is not
anonymous.

## Decision

Three tiers, derived from the session, never stored in it:

| | who | may |
|---|---|---|
| owner | one GitHub id | everything |
| allowed | ids in `AUTH.allow` | whatever is granted |
| guest | anyone else who logs in | nothing yet |

`roleOf(userId)` is the only way to ask. **No path may ask whether a session
exists** — that question answers `true` for any stranger who clicked the
button, which is the failure this separation exists to prevent. The sentence
that survives from `interactions.md` is the reason: GitHub 登录只证明"是某个
GitHub 用户",不证明是你.

Identity is compared by **numeric GitHub id**. A username can be changed and
the abandoned one becomes available to register, so a list written in usernames
hands the owner's privileges to whoever takes the old name next. The login is
kept beside the id as a label for people reading the file; nothing compares
against it.

## Rejected

**The allowlist at the door.** It makes the site's identity binary — you are
the owner or you are nobody — and forecloses the thing a login is for here:
knowing who left a comment. It also hides the real rule, because with only one
person able to log in, "has a session" and "is the owner" are the same
predicate, and the day that stops being true nothing reports it.

**Storing the role in the session record.** It would freeze a decision taken
at login. Removing someone from the list would leave their existing session
holding the privileges it was minted with, and revocation would mean hunting
down records rather than editing a list.

**Cloudflare Access.** Recorded in `docs/interactions.md` and unchanged: it is
less code, and the door is then state in a console — invisible to git,
unreviewable, and gone on a change of host.

## Consequences

- Anyone may create a session, and each one is a KV write. On the free plan
  that budget is 1000 writes a day, so a login storm is a real if unlikely way
  to exhaust it. Nothing rate-limits this yet.
- A logout deletes the record rather than only clearing the cookie, so a copied
  cookie dies with it. KV is eventually consistent, so "dies" is within a
  minute rather than instantly.
- The session cookie is `SameSite=Lax`, not `Strict`. The callback is a
  top-level navigation from github.com, and under `Strict` the browser
  withholds the state cookie on exactly that request — the guard would reject
  the only traffic it exists to admit.
- The head bar shows who is logged in through a deferred server island, which
  costs about 1.2 KB and one small request per page in the `full` profile. The
  pages themselves stay static files served ahead of the Worker. The `static`
  profile resolves the component to one that renders nothing, chosen by an
  alias before the build — a runtime condition would leave the island in the
  module graph, and its presence alone makes the build emit a server entry.
