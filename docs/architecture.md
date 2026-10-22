# The design layer and the data layer

The site's central constraint: **you can throw away the whole design layer and
rewrite it, and the data does not change.**

## The two layers

```
data layer — no line changes in a redesign
  src/content/            markdown. Data only
  src/content.config.ts   collection registration
  src/models/content/    field definitions and tag validation
  src/selectors/content/collections.ts  collection schema interface
  src/persistence/content/  collection reads and Astro renders
  src/astro.binding.ts    framework content access, through virtual:astro
  src/config/tags.ts      the tag registry (the single source)
  src/config/site.config.ts  site identity, navigation, social links
  src/selectors/posts.ts  posts, tags, the novel
  src/selectors/notes.ts  notes, and the permalink they publish
  src/selectors/interactions/promoted.ts promoted comments
  src/selectors/interactions/comment-view.ts withdrawal and tombstone visibility
  src/selectors/interactions/comment-runs.ts typed run labels and text
  src/selectors/interactions/comment-display.ts safe links and date labels
  src/selectors/interactions/comments-live.ts full-profile withdrawal view
  src/selectors/interactions/comment-archive.ts archive snapshot reads and placement
  src/services/interactions/{promote,tombstone,unpromote}.ts comment operation plans
  src/services/interactions/promote-text.ts typed-content conversion
  src/persistence/interactions/comment-operation-sql.ts comment operation SQL
  src/services/recovery/ portable recovery contract, selection and plans
  src/persistence/interactions/recovery-sql.ts recovery SQL construction
  scripts/*.mjs           the commands the Makefile runs
  Makefile                the entry point for every operation

design layer — replaceable as a whole
  src/layouts/  src/components/  src/pages/  src/styles/
```

Neither list covers the backend features or `src/platform/`, the host boundary.
ActivityPub registrations live in `src/routes/activitypub/`; its use cases,
reads, reactions and protocol calls live in services, selectors, signals and gateways.
Auth handlers live in `src/routes/auth/`;
the temporary login page lives in `src/pages-extra/auth/`. Auth also spans edges,
services, record persistence and a GitHub gateway; [interactions](interactions.md#the-write-entry-point)
describes their roles. The second architectural rule in `CLAUDE.md` governs
`src/platform/`.

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

**Views reach application data through the middle band: services and selectors.**
They receive data as props or call that band directly. Selectors prepare what views
print. Pages keep route paths and `getStaticPaths`; their templates pass values to
feature components. Those components own markup and styles, including when only one
page uses them. Home, posts, notes, tags, the novel and the not-found view each have
a feature directory under `src/components/`.

Server islands, full/static wrappers, aliases and note-slot placement remain view
composition. Each full-profile post or year archive has one comments island.
Deferred responses use `private, no-store`; prerendered pages contain no personal
identity or live comment text. The shell composes `virtual:session-bar`, whose
renderer resolves its own session through the middle band.

They import result types through selectors, never models or the binding.
They never import `astro:content`, including types. Configuration and neutral
`src/lib/` helpers remain available across the tree. See [ADR 0018](decisions/0018-src-is-layered-by-role.md).

The content selector interfaces under `src/selectors/`:

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
| `notes.ts` | `allNotes()` / `noteYears()` | notes, newest first, and their archive years |
| | `noteHref(note)` | the note's URL |
| | `noteHtml(note)` | the note's markup |
| | `Note` | note result type |
| `interactions/promoted.ts` | `commentsFor(slug, withdrawn?)` | the promoted comments under one post or note |
| | `handle(author)` | the handle derived from an ActivityPub identity's actor URL |
| | `Comment` | promoted comment result type |
| `interactions/comment-view.ts` | `visibleComments()` / `CommentLike` | withdrawal and fixed-point tombstone visibility keyed by comment id |
| `interactions/comment-runs.ts` | `runLabel()` / `renderedText()` / `CommentRun` | typed comment runs, prepared for display |
| `interactions/comment-display.ts` | `safeHref()` / `stamp()` | validated comment links and existing date labels |
| `interactions/comments-live.ts` | `liveCommentsFor(slug)` / `liveCommentsForMany(slugs)` | the full profile's current withdrawal view |

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
new design        rewrite layouts / components / pages / styles only
add a CSS framework
                  a design-layer change. The data layer does not see it
replace Astro     adapt src/astro.binding.ts and src/content.config.ts
                  while preserving the persistence and collection contracts
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
