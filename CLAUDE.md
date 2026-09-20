# CLAUDE.md

A personal blog: essays, periodic summaries, and one serialised novel.
Chinese content, Astro 7, no theme.

## The architectural rules

Two, and they are the same shape: put what changes behind one door, so the rest
of the tree does not have to know it changed.

**One — the design layer must not import `astro:content`.** It reads from
`src/lib/` and nothing else.

```
data layer — untouched by a redesign
  src/content/            markdown
  src/content.config.ts   field definitions, tag validation
  src/tags.ts             the tag registry
  src/site.config.ts      identity, navigation, links
  src/lib/posts.ts        posts, tags, the novel
  src/lib/notes.ts        notes, and the permalink they publish
  scripts/*.mjs           fill, check, create
  Makefile

design layer — replaceable wholesale
  src/layouts/  src/components/  src/pages/  src/styles/
```

See `docs/architecture.md` for the first, `docs/configuration.md` for every
switch and how they interact. When adding data a page needs, add it to
`lib/posts.ts` first.

**Two — nothing outside `src/platform/` may reach a host-specific service.**
Not only `cloudflare:workers`, `@fedify/cfworkers`, `node:*`, `Deno.*` — also
any call that would change with the host: object storage, a queue, a database,
a third-party API. The test is whether moving hosts would rewrite the line, not
whether it imported anything unusual.

What the protocol requires does not count: Fedify fetching a remote actor is
the same call wherever it runs.

The deployment target is chosen before the build, not at runtime: an env var
selects both the Astro adapter and which file `virtual:platform` resolves to, so
the implementation for the other target is never in the module graph and its
imports never have to exist.

```js
// astro.config.mjs
const TARGET = process.env.DEPLOY_TARGET ?? "cloudflare";
adapter: TARGET === "node" ? node() : cloudflare(),
vite: { resolve: { alias: { "virtual:platform": `./src/platform/${TARGET}.ts` } } }
```

This rule is stricter than the first in one way: breaking rule one makes a
redesign tedious, breaking rule two makes the build fail outright on the other
platform.

`DEPLOY_TARGET` is deliberately not in `site.config.ts`. That file describes the
site, and where a copy of it happens to run is a property of the deployment, not
of the site — a different question, changed by a different person, on a
different schedule.

**What this rule cannot make portable**, and the honest reason to keep it small:

- **The actor's URL.** `https://yaame.dev/users/yaame` is written into every
  follower's database. Moving the compute behind that name is free; moving the
  name is an account migration.
- **Host-specific capabilities.** Queues, edge rendering — another platform needs
  its own answer, not a different import.
- **The deploy configuration itself.** `wrangler.jsonc` has no abstract form.

There is no `src/platform/` yet, because the site is static and imports nothing
host-specific. The rule takes effect with the first server-rendered route.

## Rules that live in the data layer, not in pages

- **`periodYear`** takes the year from the *filename*, not the publication
  date. The summaries are written after the fact, so grouping by date puts a
  post under a heading its own title contradicts.
- **`chapterCount`** counts Han-numeral headings in the novel's body. A page
  should not know that rule.
- **Tags** must exist in `src/tags.ts`. An unknown tag fails the build rather
  than producing a page nobody visits.

## Commands

```
make check     frontmatter → build → link check   (CI runs this exact command)
make new       interactive; dispatches to newpost / newtag
make fix       fill missing description and tags, never overwriting written ones
make tags      the registry and its usage counts
```

## Language

**English for everything the repository says about itself** — commit messages,
code comments, `docs/`, this file. **Chinese for everything the site says to a
reader** — nav labels, tag labels, pagination, and the prose in
`src/content/`.

The split is by audience, not by file type: a reader of the blog gets Chinese,
a reader of the repository gets English.

## Where a piece of information belongs

Four channels, and a fact belongs to exactly one. The question is always *who
needs this, and what do they lose if it is missing*.

| Channel | Reader | Answers | Rots into |
|---|---|---|---|
| `README.md` | a person, arriving | what this is, how to run it | nobody can start |
| `CLAUDE.md` | an agent, every session | what must not be done, and where the boundaries are | the rule is broken every time |
| `docs/decisions/` | either, before reworking an area | why the rejected option was rejected | a settled argument is reopened |
| a code comment | whoever edits this line | what breaks if the line changes | the next editor breaks it |

An agent starts every session with no memory of this repository and cannot see
the running site. Anything it must not do, and anything only visible at
runtime, has to be written down or it does not exist.

**Before adding to `CLAUDE.md`, ask whether the code already says it.** Commands
live in the `Makefile`; structure lives in the tree. This file is for what
cannot be derived — the two architectural rules are the model: nothing reports
a violation, so the rule has to be stated.

## Comments

**Default to none.** Names and types say *what*; the code says *how*. A comment
earns its place only by saying what the next editor cannot see:

- **Consequence** — what breaks, and where it surfaces. *"The two documents must
  agree. Changing either means changing both."*
- **Constraint** — an invariant the compiler does not enforce.
- **An absence** — why something expected is not here. *"No `actorId` constant
  here on purpose: a second copy would agree today and diverge the moment the
  route pattern changes, without anything reporting it."*

**Do not argue design in code.** Which pattern was chosen, what was tried first,
which alternative was weighed — that is `docs/decisions/`. A comment may state
the consequence of the decision; the reasoning behind it belongs where it can be
read whole and superseded cleanly.

Four things never go in a comment:

1. **The code's own history.** "Used to be", "previously", "no longer
   registered" — true only until the next change, and stale silently. Describe
   the constraint as it stands. *Runtime state that no longer holds — an inbox
   that no longer exists — is not history; it is the consequence, and belongs.*
2. **A named call site.** "Mirrors the X hook", "matches the Y selector" — the
   name changes and the comment becomes a false lead. Describe the constraint,
   not the caller.
3. **Section dividers.** `// ---- helpers ----` is navigation noise. Needing one
   means the file should be split.
4. **Narration.** Restating the line below it, or the assertion in a test.

Before keeping one: *remove it — does the next reader lose something the code
does not contain?* If not, drop it.

## Commit messages

Conventional Commits, and the subject is a sentence saying what is now true:

```
feat(ap): pinned posts, which is what a stranger sees first
fix(ap): unfollow is its own target
docs: record the one bare force-push and why
```

`type` is `feat`, `fix`, `docs`, `chore`, `ci`, `build`, `refactor` or `test`;
`scope` is optional and names the area (`ap`, `ci`, `comments`). **Not an
imperative fragment** — `fix: unfollow is its own target`, not `fix: fix the
unfollow target`.

**Keep it short.** A subject alone is usually enough; two or three lines of body
when the reason is not visible in the diff. The commit says why, not what — the
diff already says what, and at length it stops being read.

**Never let `close`, `fix` or `resolve`, in any inflection, sit immediately
before an issue reference you do not mean to close.** GitHub matches the two
adjacent tokens anywhere in the body and reads no negation and no possessive, so
a sentence explaining why an issue must stay open will close it. Write *Filed,
not addressed here: `#<n>`*, and put a word between the keyword and the number.
Scan before posting: `rg -n -i '(clos|fix|resolv)\w*:?\s+#\d'`.

Staging discipline is mandatory: name every path, never `git add -A/./-u`,
and read `git diff --cached --stat` before committing.

## Branching and merging

Work lands on `main` directly — commit, `make check`, push. Nothing here
requires review, and a pull request adds a step without adding a reader.

When a change is large enough to want its own branch, merge it locally:

```
git switch main && git pull --ff-only
git merge --no-ff --gpg-sign -m "[Domain]: ..." <branch>
git push origin main
```

**Never land a branch through GitHub's "Rebase and merge".** PR #16 went in
with nine signed commits and left nine unsigned ones on `main`.

| How it lands | The branch's commits | Their signatures |
| --- | --- | --- |
| Locally, `--no-ff --gpg-sign` | kept | kept, and the merge commit is signed too |
| "Create a merge commit" | kept | kept; GitHub signs the merge commit itself |
| "Squash and merge" | replaced by one | lost; the replacement is signed by GitHub |
| "Rebase and merge" | rewritten | **lost, and nothing signs the rewrites** |

Only the first two leave commits on `main` signed by their author. A commit
signed by GitHub attests that GitHub performed the merge, not that you wrote
the code. `git log --format='%h %G? %s'` is how to read this back.

## One place uses a bare `--force`

`.github/workflows/tombstones.yml` force-pushes `comments/tombstones`. The
standing rule is never to, and the exception is narrow: that branch is a
generated artefact, rebuilt from `main` on every run out of data held in D1.
Nobody works on it, and losing it costs one re-run.

`--force-with-lease` was tried there and was worse than useless: CI checks out
only `main`, so there is no remote-tracking ref for the lease to compare
against, and it fails closed with "stale info" — a refusal that has nothing to
do with anyone having touched the branch.

Anything you want to keep on that branch, put on `main` instead.

## Outside the repository

One Cloudflare redirect rule sends everything on the apex except the federated
paths to the blog.

It is not middleware, because middleware never sees those requests. Static
assets are served ahead of the Worker: a path that matches a file is answered
from the file, and one that matches nothing is answered 404 without the Worker
being invoked. Setting `not_found_handling: "none"` did not change that —
measured. Middleware does run for declared routes, so the limit is on
unmatched paths specifically.

This does not stand in the way of anything the pages themselves call. A server
island fetches a route, not a file, so no asset matches and the request reaches
the Worker normally. What assets-first prevents is interception, not
invocation.

## URL contract

`/posts/{slug}/`, `/tags/{tag}/`, `/komorebi/`, `/notes/`, `/notes/{year}/`.
Trailing slashes always. Changing these is an externally breaking change, not
a refactor.

`/notes/{year}/#{id}` is stricter than the rest: it is the `url` a note
publishes to the fediverse, so it is in other people's databases and cannot be
taken back. Notes may be added to a year; nothing already in one may move.
See `docs/decisions/0009`.

**A post has a title and a note does not** — that, not length, is the line
between the two collections, and `content.config.ts` enforces it. A short
titled piece is a post.

## Not in version control

`docs/identity.md` and `komorebi-notes.md` are deliberately gitignored.
