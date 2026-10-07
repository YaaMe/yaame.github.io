# The design layer and the data layer

The site's central constraint: **you can throw away the whole design layer and
rewrite it, and the data does not change.**

## The two layers

```
data layer — no line changes in a redesign
  src/content/            markdown. Data only
  src/content.config.ts   field definitions and tag validation
  src/tags.ts             the tag registry (the single source)
  src/site.config.ts      site identity, navigation, social links
  src/lib/posts.ts        posts, tags, the novel
  src/lib/notes.ts        notes, and the permalink they publish
  src/lib/comments.ts     promoted comments
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
through `src/lib/`. It may also import `src/site.config.ts` and `src/tags.ts`.

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
| `comments.ts` | `commentsFor(slug)` | the promoted comments under one post or note |
| | `handle(actorId)` / `paragraphs()` / `segments()` | comment text, prepared for display |

This list is everything the design layer can get. To add new data, add it
here first.

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
replace Astro     in the data layer, only content.config.ts and src/lib/*.ts
                  know Astro. Content, the tag registry, the scripts and
                  the Makefile stay as they are
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
