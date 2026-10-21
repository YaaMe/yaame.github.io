# 0007. Interactions live in a database the host provides

Status: accepted
Date: 2026-09-19
Revised: 2026-10-21

## Context

Posts come from git and are a projection of it. What arrives from outside —
replies, boosts, likes — has no such source: it has to be stored somewhere, and
it has to be counted, grouped by thread, de-duplicated by activity id, and
marked deleted or undone in place.

The platform seam already answers "what does this host offer" for a KV store and
a queue. A database is the same kind of question.

## Decision

`platform.db`, beside `kv` and `queue`, holding a SQL database the host
supplies: D1 on Cloudflare, `node:sqlite` in a process, `false` where there is
none. Drizzle renders the queries from one set of table definitions in
`store/schema.ts`.

## Rejected

**Keeping interactions in KV.** It is already there and costs nothing to reach,
and it cannot do the work. Cloudflare KV allows one write per second per key, is
eventually consistent for up to sixty seconds, and has no atomicity — so a
comment list held under one key loses replies whenever two arrive together, with
nothing reporting the loss. It also cannot count or group: every reply count on
a page would mean reading the whole list.

**A document store.** The access patterns here are relational and small: replies
by thread, reactions by object and kind. The one thing a document store would
buy is schema freedom, which is the thing least wanted for rows that must
de-duplicate on a primary key.

**Writing the SQL by hand.** Rendering CRUD, quoting identifiers and spelling
conflict clauses per dialect is solved work. The reason a dependency was
acceptable here is specific and should be re-checked before it is upgraded:
Drizzle ships with **no dependencies of its own** and a provenance attestation.

**Running migrations once per isolate, on first access.** Dropped by
[0018](0018-src-is-layered-by-role.md): migration is its own operation,
separate from serving requests, and no request triggers it.

## Consequences

- Moving to Postgres means Drizzle's postgres driver and the same table
  definitions, not a second renderer written here.
- `Database` is typed with both parameters open, because D1 is async and
  `node:sqlite` is sync. Pinning either admits one driver and rejects the other.
- Affected rows are read with `.returning()`, never a driver's changed-row
  count: D1 reports `rowsAffected` and `node:sqlite` reports `changes`, so
  reading the count makes every insert on node look like a duplicate while it
  quietly succeeds.
- A deploy holds no database credentials, deliberately. Migration runs outside
  the deploy ([0018](0018-src-is-layered-by-role.md)): a person runs it from an
  operations script, or a separate CI job runs an ordinary migration. Only that
  migration job may hold the database permission migrations need.
- Apart from that migration job, `D1 Read` is the only database permission CI
  holds. Writing `promoted_at` is local, under your own login.
