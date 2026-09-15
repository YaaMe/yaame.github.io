# CLAUDE.md

A personal blog: essays, periodic summaries, and one serialised novel.
Chinese content, Astro 7, no theme.

## The one architectural rule

**The design layer must not import `astro:content`.** It reads from
`src/lib/posts.ts` and nothing else.

```
data layer — untouched by a redesign
  src/content/            markdown
  src/content.config.ts   field definitions, tag validation
  src/tags.ts             the tag registry
  src/site.config.ts      identity, navigation, links
  src/lib/posts.ts        the only data export
  scripts/*.mjs           fill, check, create
  Makefile

design layer — replaceable wholesale
  src/layouts/  src/components/  src/pages/  src/styles/
```

See `docs/architecture.md`. When adding data a page needs, add it to
`lib/posts.ts` first.

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

**Commit messages and code comments in English. UI text and documentation in
Chinese** — the site is Chinese, so nav labels, tag labels, pagination and
prose stay as they are.

## Commit messages

Follow the house style:

```
[Domain]: A sentence saying what changed

One or two paragraphs on why, when the why is not obvious.
```

`Domain` is the area touched — `Content`, `Design`, `Data`, `Build`, `Docs`,
`Chore`. The subject is a sentence, not an imperative fragment.

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

## URL contract

`/posts/{slug}/`, `/tags/{tag}/`, `/komorebi/`. Trailing slashes always.
Changing these is an externally breaking change, not a refactor.

## Not in version control

`docs/identity.md` and `komorebi-notes.md` are deliberately gitignored.
