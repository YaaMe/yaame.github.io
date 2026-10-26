# CLAUDE.md

A personal blog: essays, periodic summaries, and one serialised novel.
Chinese content, Astro 7, no theme.

## The architectural rules

Two, and they are the same shape: put what changes behind one door, so the rest
of the tree does not have to know it changed.

**One — entrances and views reach data only through the middle band.** Application
routes live in `src/pages/`, `src/pages-extra/` or `src/routes/`. Astro routes
`src/pages/` by file. Integrations in `astro.config.mjs` inject pages for the
full profile from `src/pages-extra/` and enabled handlers from `src/routes/`.
Routes call the middle band
(`src/services/`, `src/selectors/`) and hand the result to views. The design
layer — `src/components/`, `src/layouts/`, `src/styles/` — is views. A view
takes data as props, or calls the middle band itself. What a view prints, a
selector prepares (URLs, handles, labels).
A route's template only passes data to a layout or component; markup lives in
views, so a redesign rewrites views and never a route.
Route paths and `getStaticPaths` stay in pages. Page markup and styles live in
feature directories under `src/components/`, even for one page.

A server island is a view, and its component lives in `src/components/`. Astro
serves every island through one route that the framework owns, so an island
has no route file in this tree. An island reads request-time data through the middle band
and renders views: `src/components/session/server.astro` calls `current()`
from `src/services/auth/session.ts`.

A view may call a service, writes included. If a write needs uniform
handling — authentication, CSRF, a transaction, logging — it enters through a
route, so the handling is in one place.

A request is a public endpoint, props are internal; open a request only for data
that exists only at request time. Inside a request,
everything else is internal: who is signed in is read through `src/services/`
by the island or route that renders it, and passed on as props. It needs no
endpoint of its own.

Neither an entrance nor a view imports `src/persistence/`, `src/models/`,
`src/migrations/`, `src/gateways/`, `virtual:platform`, `virtual:astro` or
`astro:content`, not even for types; a view takes result types through selectors. Any
layer may import `src/config/` and `src/lib/`. One exception: the queue
consumer takes its own queue transport (ack, retry) from `virtual:platform`;
every state change it makes goes through `src/services/`.

Imports point downward, one layer at a time: a layer reaches only the layer
directly below it. Entrances and views reach the middle band, the middle
reaches the bottom, and the bottom reaches the boundary. Entrances also render
views. A type declaration file (`.d.ts`) belongs to no layer: any layer may
import its types. From top to bottom:

Keep server islands, full/static wrappers, component aliases and note-slot placement
in components. Each post or year archive has one comments island in the full
profile. Its deferred response sets `private, no-store`; prerendered HTML contains
neither personal identity nor live comments. `Base.astro` may compose
`virtual:session-bar`. Session resolution belongs to the renderer that needs it.

```
entrances — routes
  src/pages/              pages and endpoints routed by file
  src/pages-extra/        pages injected for the full profile
  src/routes/             injected API, ActivityPub and login handlers
  worker/consumer.ts      queued messages
  scripts/*.mjs  Makefile operations: the owner's commands, at the repository root
edges of the entrances
  src/params/             what comes in, validated
  src/schemas/            what goes out
framework declarations — what the application declares to Astro; directly above the middle
  src/content.config.ts   collections, with schemas from the models through a selector (path fixed by Astro)
views — the design layer, replaceable wholesale; rendered by routes; directly above the middle, as the entrances are
  src/components/  src/layouts/  src/styles/   server islands included
middle — untouched by a redesign, as is everything below
  src/services/           writes, decisions, use cases
  src/signals/            reactions to a change in data
  src/selectors/          reads, shaped for the caller
    posts.ts              posts, tags, the novel
    notes.ts              notes, and the permalink they publish
bottom
  src/persistence/        data access: content/ (git), interactions/ (D1), records/ (KV)
  src/models/             tables, row schemas, invariants of one row, keys
  src/migrations/         migration history and migrate()
  src/gateways/           external systems, both ways: the Fedify instance inbound routes hand requests to, and outbound calls (ActivityPub delivery and resolution, GitHub)
boundary
  src/platform/           the host (rule two), through virtual:platform
  src/astro.binding.ts    the framework, through virtual:astro
anywhere
  src/config/             the owner's settings: site, tags, ActivityPub, login, follow intent, data register
  src/lib/                abstract, neutral logic; imports none of the above
  src/content/            the git database itself: Markdown and JSON
```

A signal is a reaction to a change in data — an announcement after the actor or
a post changed, a log after a follower left — whether or not an ORM hook fires
it: the change succeeds even if the reaction does not run.

Git content — posts, notes, promoted comments — is a database like the
interaction database: `getCollection` is its query layer and
`src/content.config.ts` registers its collections. `src/persistence/content/`
reads it through `virtual:astro`, a build-time alias like `virtual:platform`,
which resolves to `src/astro.binding.ts`. In the middle band and below, that
file is the only module that imports `astro:*`; a new framework binding is added
to it. Views may import rendering modules such as `astro:assets` and
`astro:transitions`, never `astro:content`.
`src/content.config.ts`, whose path Astro fixes, imports framework modules as a
framework declaration. The queue consumer's build maps
`virtual:astro` to a stub that refuses: git content exists only inside the
Astro build, so the consumer may import the persistence layer but never read
content.

Scripts are operations: a user-facing entrance for another stream of
events — the owner's commands — as routes are for requests and the queue consumer is for
queued messages. They stay in `scripts/`, outside `src/`, and are not part of
the application. They never re-implement an application rule — validation,
ids, visibility — but import it from `src/`; the operation's own procedure
(git and pull-request steps, prompts, CLI plumbing) stays in `scripts/`.

`src/lib/` is a library in the ordinary sense: no protocol, no storage, no
host, no `astro:content`; any layer may use it. Placement of backend code
follows the `backend-layering` skill.

See `docs/architecture.md` for the first, `docs/configuration.md` for every
switch and how they interact. When adding data a page needs, add it to
the relevant selector first.

Collection schemas reach `src/content.config.ts` through
`src/selectors/content/collections.ts`. Keep the declaration file at Astro's fixed
path, with only loaders and registration. Content persistence uses `virtual:astro`;
the site binds it to `src/astro.binding.ts`, and the consumer to
`worker/astro.stub.ts`. The stub throws on a read or render, while imports succeed.
Posts, notes and promoted-comment selectors reach content through persistence.
`src/lib/` holds neutral logic.

Post filename grammar belongs to `src/models/content/post-filename.ts`; its
matches and calendar facts leave acceptance, tags and fallbacks to each caller.
The post selector uses the model directly. Authoring commands reach services in
`src/services/authoring/`, which must import under plain Node without virtual
aliases. Keep their acceptance modes separate: post creation checks calendar
validity, frontmatter infers tags by shape, and interactive tag creation has
wider slug and duplicate rules than the dedicated command.

`calendarDate()` in `src/models/content/fields.ts` owns the site-timezone calendar
split used by post stamps and the notes selector. Its `calendarDateLabel()` owns
the `y-mo-d` label, which views receive through selectors. Note archive years still come
from their files; changing the display timezone must not change a note's URL.

**Two — runtime host-specific code lives behind a platform entry point, one per tree.** In
`src/`, nothing outside `src/platform/` may reach a host-specific runtime data
service. Not only
`cloudflare:workers`, `@fedify/cfworkers`, `node:*`, `Deno.*` — also
any call that would change with the host: object storage, a queue, a database,
a third-party API. The test is whether moving hosts would rewrite the line, not
whether it imported anything unusual.

Each target is either `<target>.ts` or `<target>/` with `index.ts`, never both:
the alias has no extension, and a file beside a directory of the same name wins
silently.

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
vite: { resolve: { alias: { "virtual:platform": `/src/platform/${TARGET}` } } }
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
- **The deploy configuration itself.** `wrangler.jsonc`, its generators and
  route/type commands have no abstract form; deployment setup is outside this
  runtime rule.

`src/platform/` holds `cloudflare/` and `node/`, two implementations of the
`Platform` interface in `types.ts`, and `src/` reaches them only through
`src/platform/index.ts`. The queue consumer in `worker/` imports
`virtual:platform` directly; `worker/tsconfig.json` maps it to the Cloudflare
target, because Wrangler's own alias table does not accept an extensionless
path.

Under ADR 0018 and O8, each host's recovery module in `src/platform/<target>/`
uses host-neutral rules in `src/services/recovery/`, and the host's script entry
points call that module.

Scripts follow the same boundary for runtime data operations. Host-specific
script work enters through bash entry points under `scripts/platform/<target>/`.
Makefile and CI choose the target from `DEPLOY_TARGET`. Host-specific readers
open connections and handle files or subprocesses.
The application logic they call is host-free and receives supplied snapshots and
execution facilities. Deployment configuration and its generators, including
`scripts/wrangler-config.mjs` and `scripts/wrangler-routes.mjs`, are outside
this rule.

Script-facing comment operations under `src/services/interactions/` must import
under plain Node without either virtual alias. Keep their snapshot plans separate
from services that load runtime stores. The typed-content converter keeps its own
URL predicate until B12; archive rewriting keeps its timestamp precedence until B5.
O6 is undecided, so the editable filter remains `scripts/promote-filter.mjs`.

## Rules that live in the data layer, not in pages

- **`periodYear`** takes the year from the *filename*, not the publication
  date. The summaries are written after the fact, so grouping by date puts a
  post under a heading its own title contradicts.
- **`chapterCount`** counts Han-numeral headings in the novel's body. A page
  should not know that rule.
- **Tags** must exist in `src/config/tags.ts`. An unknown tag fails the build rather
  than producing a page nobody visits.
- **Registered data has one location.** Once a kind is in
  `src/config/data.config.json`, current code in one runtime takes its location from
  the register and nowhere else. `make data` validates it and emits the ignored
  plain-JS module that both `src/` and Node scripts import; the declaration file
  gives `src/` types. Shipped migration SQL is schema history and keeps its
  original names.

## Commands

```
make check     wrangler config → frontmatter → data register → types → build → tests → link check   (CI runs this exact command)
make new       interactive; dispatches to newpost / newtag
make fix       fill missing description and tags, never overwriting written ones
make tags      the registry and its usage counts
```

## Language

**English for everything the repository says about itself** — commit messages,
code comments, `docs/`, GitHub issues, this file. **Chinese for everything the site says to a
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

**While no workflow runs `make check` on `pull_request`**, a pull request here
would land without CI, so work lands without one: commit to `main`, `make check`,
push. A change large enough to want its own branch is merged locally:

```
git switch main && git pull --ff-only
git merge --no-ff --gpg-sign -m "[Domain]: ..." <branch>
git push origin main
```

**Once one does**, land a branch through a pull request with "Create a merge
commit" instead.

Either way, the review loop runs before the work lands.

**Never land a branch through GitHub's "Rebase and merge".** PR #16 went in
with nine signed commits and left nine unsigned ones on `main`.

`main` is never force-pushed. A feature branch may be squashed and force-pushed
before it is merged, and branches that CI regenerates from `main` on every run
are force-pushed by their workflow. The generated branches are disposable
proposals; the signed history on `main` is not.

| How it lands | The branch's commits | Their signatures |
| --- | --- | --- |
| Locally, `--no-ff --gpg-sign` | kept | kept, and the merge commit is signed too |
| "Create a merge commit" | kept | kept; GitHub signs the merge commit itself |
| "Squash and merge" | replaced by one | lost; the replacement is signed by GitHub |
| "Rebase and merge" | rewritten | **lost, and nothing signs the rewrites** |

Only the first two leave commits on `main` signed by their author. A commit
signed by GitHub attests that GitHub performed the merge, not that you wrote
the code. `git log --format='%h %G? %s'` is how to read this back.

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
between the two collections, declared by their schemas in `src/models/content/`. A short
titled piece is a post.

## Not in version control

`docs/identity.md` and `komorebi-notes.md` are deliberately gitignored.
