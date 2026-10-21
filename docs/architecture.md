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
  src/lib/recovery.ts portable recovery contract and selection
  scripts/recovery-records.mjs host-free JSON-record recovery adapter
  scripts/*.mjs           the commands the Makefile runs
  Makefile                the entry point for every operation

design layer — replaceable as a whole
  src/layouts/  src/components/  src/pages/  src/styles/
```

Neither list covers `src/integrations/` (ActivityPub and login) or
`src/platform/` (the host boundary). The second architectural rule in
`CLAUDE.md` governs `src/platform/`.

## The rule

**Views reach application data through the middle band: services and selectors.**
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
projections can wrap them. `interactions/comments.ts` retains SQL thread, withdrawal
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
the site-timezone date parts for both post stamps and note reads. The note's
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

Scripts reach this model through the plain-Node forward at
`src/services/authoring/posts.ts`. Step 14 adds authoring use cases there.
The post selector imports the model directly. The interactive and dedicated tag
commands keep their different slug validation until B6.

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
