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
  src/lib/posts.ts        posts, tags, the novel
  src/lib/notes.ts        notes, and the permalink they publish
  src/lib/interactions/comments.ts     promoted comments
  src/lib/interactions/comment-view.ts withdrawal and tombstone visibility
  src/lib/interactions/comments-live.ts full-profile withdrawal view
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

**The design layer must not import `astro:content`.** It reads content only
through `src/lib/`. It may also import `src/config/site.config.ts` and `src/config/tags.ts`.

What `src/lib/` exports:

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
| `notes.ts` | `allNotes()` / `noteYears()` | notes, newest first, and their archive years |
| | `noteHref(note)` | the note's URL |
| | `noteHtml(note)` | the note's markup |
| `interactions/comments.ts` | `commentsFor(slug)` | the promoted comments under one post or note |
| | `handle(author)` | the handle derived from an ActivityPub identity's actor URL |
| `interactions/comment-view.ts` | `visibleComments()` | withdrawal and fixed-point tombstone visibility keyed by comment id |
| `interactions/comment-runs.ts` | `runLabel()` / `renderedText()` | typed comment runs, prepared for display |
| `interactions/comments-live.ts` | `liveCommentsFor(slug)` | the full profile's current withdrawal view |

This list is everything the design layer can get. To add new data, add it
here first.

The interaction key scheme lives in `src/models/interactions/key-scheme.ts`.
It owns the namespace, source names and input normalisation. Federated comment
ids use the signing actor URL and Note object id.

Collection schemas live in `src/models/content/{posts,notes,komorebi,comments}.ts`.
Posts and komorebi share tags, stamped dates and common fields from
`src/models/content/fields.ts`. `src/selectors/content/collections.ts` exposes all
four schemas to `src/content.config.ts`, which holds only loaders and registration.
The models and their schema selector also import under plain Node without aliases.

Runtime reads follow `src/lib/` → `src/persistence/content/` → `virtual:astro`.
The site resolves the alias to `src/astro.binding.ts`; the consumer resolves it to
`worker/astro.stub.ts` through `worker/tsconfig.json`. Importing the stub succeeds.
Calling a collection read or Astro render throws explicitly.

`src/lib/posts.ts`, `src/lib/notes.ts` and `src/lib/interactions/comments.ts` keep
their public exports and temporarily import content persistence. ADR 0018's
step 7b moves these callers into selectors. Sorting, visibility, URLs and date
formatting stay in those callers during this split. `noteHtml()` keeps its
synchronous Marked conversion. Content reads retain their existing call counts.

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

`/posts/{slug}/` is built by `href()` in `lib/posts.ts`. `/notes/{year}/#{id}`
is built by `noteHref()` in `lib/notes.ts`. Both live in the data layer, but
they must be more stable than the data layer itself. You may replace the
data-layer code. If you change a URL, treat it as an externally breaking
change.

`PAGE_SIZE` is part of the same contract. If it changes, the posts on
`/tags/{tag}/page/2/` change with it.

The note URL is stricter still. It is the `url` a note publishes to the
fediverse, so it is stored in other servers' databases. See
[decision 0009](decisions/0009-note-urls-are-a-year-archive-and-an-anchor.md).
