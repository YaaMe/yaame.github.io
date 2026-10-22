# The design layer and the data layer

The site's central constraint: **you can throw away the whole design layer and
rewrite it, and the data does not change.**

## The layers

Imports point downward, one layer at a time: a layer reaches only the layer
directly below it. Entrances and views both sit directly above the middle band
and reach it; the middle reaches the bottom; the bottom reaches the boundary.
Entrances also render views. A type declaration file (`.d.ts`) belongs to no
layer: any layer may import its types.

```
entrances — routes
  src/pages/              pages and endpoints routed by file
  src/pages-extra/        pages injected for the full profile
  src/routes/             injected API, ActivityPub and login handlers
  worker/consumer.ts      queued messages
  scripts/*.mjs           operations: the commands the Makefile runs, at the repository root
  Makefile                the entry point for every operation
edges of the entrances
  src/params/             what comes in, validated
  src/schemas/            what goes out
framework declarations — what the application declares to Astro; directly above the middle
  src/content.config.ts   collections, with schemas from the models through a selector (path fixed by Astro)
views — the design layer, replaceable as a whole; rendered by routes; directly above the middle, as the entrances are
  src/components/  src/layouts/  src/styles/   server islands included
middle — no line changes in a redesign, nor anywhere below
  src/services/           writes, decisions, use cases
  src/signals/            reactions to a change in data
  src/selectors/          reads, shaped for the caller
bottom
  src/persistence/        data access: content/ (git), interactions/ (D1), records/ (KV)
  src/models/             tables, row schemas, invariants of one row, keys
  src/migrations/         migration history and migrate()
  src/gateways/           external systems, both ways: the Fedify instance inbound routes hand requests to, and outbound calls (ActivityPub delivery and resolution, GitHub)
boundary
  src/platform/           the host (the second rule in CLAUDE.md), through virtual:platform
  src/astro.binding.ts    the framework, through virtual:astro
anywhere
  src/config/             the owner's settings: site, tags, ActivityPub, login, follow intent, data register
  src/lib/                abstract, neutral logic; imports none of the above
  src/content/            the git database itself: Markdown and JSON
```

Git content (posts, notes, promoted comments) is a database like the
interaction database: `getCollection` is its query layer and
`src/content.config.ts` registers its collections. `src/persistence/content/`
reads it through `virtual:astro`, which resolves to `src/astro.binding.ts`.
In the middle band and below, only that file imports `astro:*`; views may
import rendering modules such as `astro:assets` and `astro:transitions`. `src/content.config.ts`
(whose path Astro fixes) imports framework modules as a framework declaration.

A request enters through a route, a page or a handler, and the route hands
what it reads to views. Views are components and layouts. A view takes data as
props, or calls the middle band itself. A request is a public endpoint and
props are internal, so a request is opened only for data that exists only at
request time. Within it, who is signed in is read through `src/services/` by
the island or route that renders it, and passed on as props.
A page's template only passes data to a layout or component, so a redesign
rewrites views and leaves every route as it is.

A server island is a view and lives in `src/components/`. Astro serves every
island through one route it owns, `/_server-islands/[name]`. It encrypts the
page's props into the page, and the deferred component renders in that
request. So an island has no route file in this tree. It works like a React
Server Component: it reads request-time data through the middle band and
renders views. `src/components/session/server.astro` calls `current()` from
`src/services/auth/session.ts`.

A view may call a service, writes included. If a write needs uniform
handling — authentication, CSRF, a transaction, logging — it enters through a
route, so the handling is in one place.
`src/lib/` is a library in the ordinary sense — no protocol, no storage, no
host, no `astro:content` — so any layer may use it, and it imports none of
them. `src/services/` and `src/selectors/` are the middle band: services hold the
writes and decisions the entrances and views call, and may call selectors to load what
they decide on; selectors never call services. Below them, placement follows the
`backend-layering` skill.

Auth handlers live in `src/routes/auth/`, and the temporary login page in
`src/pages-extra/auth/`; [interactions](interactions.md#the-write-entry-point)
describes the roles of the auth edges, services, records and gateway.

Under ADR 0018 and O8, each host's recovery module in `src/platform/<target>/`
uses host-neutral rules in `src/services/recovery/`, and the host's script entry
points call that module.

Comment commands supply snapshots to interaction services and selectors, then
execute their plans. These entries import under plain Node without a platform or
content alias. Scripts retain file/ref handling, command output and apply mode.
The shared proposal-ref reader keeps proposals separate from main. Promotion
remains add-only; unpromotion writes the archive before requesting SQL deletion.

ActivityPub has one runtime per process. Both entrances install the registrations
in `src/routes/activitypub/shared.ts`; the site also installs `site.ts`, which reads
content. The consumer graph contains no content loader. The HTTP handler in
`src/routes/activitypub/federated.ts` owns negotiation.

The object-id model in `src/models/activitypub/object-id.ts` uses the neutral
`src/lib/path-template.ts` codec. `src/selectors/activitypub/objects.ts` exposes
the scheme and constructors under ADR 0018's strict traversal rule (O1).
`astro.config.mjs` uses the narrower `object-id.ts` selector so it does not load Fedify
constructors (O2). The integration maps `{identifier}` to Astro's `[user]` and
`{slug}` to `[slug]`. Constructors receive content URLs from the post/note selectors;
they import under plain Node without a platform or content alias.

The ActivityPub and auth integration factories and dynamic-route manifest hook
live in `astro.config.mjs`. Features control which routes it injects. The manifest
uses Astro's resolved route table, including the framework's island routes.

`src/params/activitypub-paging.ts` owns AP cursor decoding, page size and the first
cursor. Dispatchers combine it with `src/lib/page.ts`, which takes an explicit
offset and size. Followers return the full list for unpaged delivery fan-out.

## The rule

**Entrances and views reach data only through the middle band.** A route or a
view calls `src/services/` and `src/selectors/`. A route passes the result to
views, as props or in a response. Neither imports `src/persistence/`,
`src/models/`, `src/migrations/`, `src/gateways/`, `virtual:platform`,
`virtual:astro` or `astro:content`. What a view prints, a selector has prepared.

Pages keep route paths and `getStaticPaths`; their templates pass values to
feature components. Those components own markup and styles, including when only one
page uses them. Home, posts, notes, tags, the novel and the not-found view each have
a feature directory under `src/components/`.

Server islands, full/static wrappers, aliases and note-slot placement remain view
composition. Each full-profile post or year archive has one comments island.
Deferred responses use `private, no-store`; prerendered pages contain no personal
identity or live comment text. The shell composes `virtual:session-bar`, whose
renderer resolves its own session through the middle band.

Views import result types through selectors, never models or the binding, and
never `astro:content`, including types. Configuration and neutral `src/lib/`
helpers remain available across the tree. See [ADR 0018](decisions/0018-src-is-layered-by-role.md).

The selector export inventory below covers every module under `src/selectors/`,
including result types and forwards. Paths are relative to that directory.

| Module | Export | |
|---|---|---|
| `posts.ts` | `allPosts()` | all posts, newest first by publication date |
| | `href(post)` | the post's URL |
| | `periodYear(post)` | the year the post covers. It comes from the filename, not the publication date |
| | `period(post)` | the period the post covers, as a printed label and a machine-readable value |
| | `allTags()` | the tags in use |
| | `PAGE_SIZE` / `pages(n)` / `slice(posts, n)` | pagination |
| | `komorebi()` / `novel()` / `chapterCount()` | the novel |
| | `content(entry)` | rendering |
| | `Post` / `Chapter` | result types for posts and novel entries |
| | `tagHref()` / `pageHref()` | tag and pagination URLs |
| | `postDisplay()` / `postList()` / `postPage()` | post rows, pagination and rendered post data |
| | `homePage()` / `tagArchive()` / `tagPage()` / `chapterPage()` | feature page data |
| `notes.ts` | `allNotes()` / `noteYears()` | notes, newest first, and their archive years |
| | `noteHref(note)` | the note's URL |
| | `noteHtml(note)` | the note's markup |
| | `Note` | note result type |
| | `noteYearHref()` / `notesForYear()` | archive URL and membership |
| | `noteDisplay()` / `noteYearPage()` / `latestNotesPage()` | note rows and page data |
| `feed.ts` | `rssFeed()` | RSS metadata and items |
| `site.ts` | `siteShell()` / `notFoundPage()` | shell links, footer and not-found data |
| `auth/login.ts` | `loginPage()` / `LoginPageData` | temporary login display, pending B11/O14 |
| `content/collections.ts` | `commentCollectionSchema` / `postCollectionSchema` / `noteCollectionSchema` / `komorebiCollectionSchema` | model schemas exposed for framework registration; intentional O1 forward |
| `interactions/promoted.ts` | `commentsFor(slug, withdrawn?)` | the promoted comments under one post or note |
| | `handle(author)` | the handle derived from an ActivityPub identity's actor URL |
| | `Comment` | promoted comment result type |
| `interactions/comment-view.ts` | `visibleComments()` / `CommentLike` | withdrawal and fixed-point tombstone visibility keyed by comment id |
| `interactions/comment-runs.ts` | `runLabel()` / `renderedText()` / `CommentRun` | typed comment runs, prepared for display |
| `interactions/comment-display.ts` | `safeHref()` / `stamp()` / `commentDisplay()` | validated links, dates and complete comment display data |
| `interactions/comments-live.ts` | `liveCommentsFor(slug)` / `liveCommentsForMany(slugs)` / `liveNoteCommentsForYear(year)` | the full profile's current withdrawal view and note-year projection |
| `interactions/comment-archive.ts` | `entryFor()` / `locate()` / `archivePath()` / `postArchivePath()` | reads and paths from supplied archive snapshots |
| | `ArchivedComment` / `ArchiveDocument` / `ArchiveSnapshot` / `ArchiveWrite` / `NoteSnapshot` | archive operation input and result types |
| `interactions/comments.ts` | `rootOf()` / `thread()` / `withdrawn()` / `withdrawnMany()` / `replyCounts()` / `replies()` / `Comment` | stored comment reads and parent interpretation |
| `interactions/reactions.ts` | `counts()` | reaction counts by content identifier |
| `interactions/followers.ts` | `all()` / `FederatedFollower` | federated follower rows |
| `interactions/counts.ts` | `interactionCounts()` | combined reply, like and share tallies |
| `activitypub/actor.ts` | `actorData()` / `keyPairs()` / `actorKeys()` | actor data and gateway key access |
| `activitypub/delivery.ts` | `deliveredTargets()` | stored delivery marks |
| `activitypub/followers.ts` | `allFollowers()` | full follower list through the interaction selector |
| `activitypub/following.ts` | `readFollowing()` | accepted following record |
| `activitypub/object-id.ts` | `OBJECT_PATH_TEMPLATE` | template-only forward for configuration-time imports |
| `activitypub/objects.ts` | `OBJECT_PATH_TEMPLATE` / `objectUrl()` / `contentIdentifierOf()` | scheme forwarded through the intentional O1 interface |
| | `note()` / `create()` / `Item` / `Tally` | protocol constructors and their value types |
| | `resolveActor()` / `resolveObject()` / `embeddedObject()` | protocol resolution through gateways |
| `activitypub/outbox.ts` | `timeline()` / `publishedItems()` / `pinnedItems()` / `pinnedCount()` | content projections for federation |

These interfaces preserve their output contracts across a redesign. New display
projections wrap them: `posts.ts` prepares home year groups, post and chapter views,
tag archives and pagination; `notes.ts` prepares note rows, latest notes and year
archives. `tagHref`, `pageHref` and `noteYearHref` own their link shapes, and
`notesForYear` selects archive membership for pages and the notes island.
`feed.ts` prepares RSS data, `site.ts` prepares shell and not-found data, and
`interactions/comment-display.ts` prepares safe comment links, labels and dates.
The reusable `Comments`, `NoteList`, `PostList` and `Progress` components retain
their paths.

`interactions/comments.ts` retains SQL thread, withdrawal
and reply reads; its `Comment` type describes a stored row. The promoted reader
has a separate module and result type so static views do not load the SQL graph.

The step 17 audit found no direct selector writes or imports of services, and no
service imports of entrance schemas or routes. `src/lib/` contains neutral encoding,
key-pattern, page-window and path-template helpers. This is a source inspection,
not a CI gate or proof of complete read purity.
See the implementation record for [the remaining B13 read-path effect](implementation/0018-relayering.md#read-path-status-b13).

See the implementation record for [GET-trigger policy under O15](implementation/0018-relayering.md#get-triggers-o15).
It also records the audit's limits, [retention and fingerprint policies](implementation/0018-relayering.md#retention-and-fingerprints), and validation.

To give a page new data, add a selector here first; the page passes it on, or
the view calls it.

The interaction key scheme lives in `src/models/interactions/key-scheme.ts`.
It owns the namespace, source names and input normalisation. Federated comment
ids use the signing actor URL and Note object id.

Collection schemas live in `src/models/content/{posts,notes,komorebi,comments}.ts`.
Posts and komorebi share tags, stamped dates and common fields from
`src/models/content/fields.ts`. `src/selectors/content/collections.ts` exposes all
four schemas to `src/content.config.ts`, which holds only loaders and registration.
The models and their schema selector also import under plain Node without aliases.

Runtime content reads follow `src/selectors/` → `src/persistence/content/` → `virtual:astro`.
The site resolves the alias to `src/astro.binding.ts`; the consumer resolves it to
`worker/astro.stub.ts` through `worker/tsconfig.json`. Importing the stub succeeds.
Calling a collection read or Astro render throws explicitly.

The post, note and promoted-comment selectors own sorting, visibility and URLs.
`noteHtml()` keeps its synchronous Marked conversion. Content reads retain their
existing call counts. `calendarDate()` in `src/models/content/fields.ts` supplies
the site-timezone date parts for both post stamps and note reads. The same model's
`calendarDateLabel()` formats their `y-mo-d` labels through selectors. The note's
archive year still comes from its file and determines its permanent URL.

`parsePostFilename()` in `src/models/content/post-filename.ts` owns the filename
grammar. It returns an optional four-digit `yearPrefix` and a complete `period` match, or
`null` for the latter. A match has a shape-only `kind` (`bare`, `year`, `month`,
or `day`), `year`, optional two-digit `month` and `day`, and
`validMonth`/`validDay` facts. A year match keeps any day suffix but has no month.
The day check retains the UTC round-trip behavior, including rejection of years
0000–0099. Consumers choose which facts matter: grouping uses the prefix,
display uses shape, creation validates dates, and frontmatter infers tags by shape.
Publication-date fallbacks remain in `src/selectors/posts.ts`.

Authoring commands call `src/services/authoring/posts.ts` for period defaults,
post timestamps, missing frontmatter and pin edits. The post selector imports
the filename model directly.

`src/services/authoring/tags.ts` reads the registered tag source, prepares additions
and counts usage. Interactive creation keeps its wider slug grammar and accepts
duplicates; the dedicated command rejects duplicates. B6 owns any unification.
`src/services/authoring/following.ts` prepares follow-intent document edits.

`src/services/authoring/notes.ts` prepares identifiers, UTC archive years, note
entries and conversion decisions. It takes configuration source and file snapshots
from scripts. Its publication probe uses the object-id model and
`src/gateways/activitypub/publication-probe.ts`, with an injected request function.
Explicit-path conversion retains its existing behavior pending B4. Post timestamps
retain local calendar fields with a fixed `+08:00` suffix pending B7.

These services import under plain Node without virtual aliases. Scripts retain
filesystem access, process execution, prompts, dry-run handling and Chinese output.
`scripts/notes-store.mjs` reads and writes the archive files; its service prepares
the documents.

## What belongs in the data layer

Ask one question: **is this rule about the content, or about how it is shown?**

`periodYear` belongs in the data layer. The yearly and monthly summaries are
written after the period ends. So the year a post covers must come from the
filename, not the publication date. That is a property of the content, not a
layout decision.

The novel's chapters are the Han-numeral headings in its body. That is also a
content rule. So `chapterCount()` counts chapters, and no page does.

## What this constraint gives you

```
new design        rewrite components / layouts / styles only
add a CSS framework
                  a design-layer change. The data layer does not see it
replace Astro     adapt framework bindings, declarations, routes and views,
                  including Astro commands in the Makefile
                  preserve content and application data rules
```

## Exception: URL shapes

The URLs are an **external contract**. They outlive both layers.

`/posts/{slug}/` is built by `href()` in `selectors/posts.ts`. `/notes/{year}/#{id}`
is built by `noteHref()` in `selectors/notes.ts`. Both live in the data layer, but
they must be more stable than the data layer itself. You may replace the
data-layer code. If you change a URL, treat it as an externally breaking
change.

`PAGE_SIZE` is part of the same contract. If it changes, the posts on
`/tags/{tag}/page/2/` change with it.

The note URL is stricter still. It is the `url` a note publishes to the
fediverse, so it is stored in other servers' databases. See
[decision 0009](decisions/0009-note-urls-are-a-year-archive-and-an-anchor.md).
