# CLAUDE.md

A personal blog: essays, periodic summaries, and one serialised novel.
Chinese content, Astro 7, no theme.

## The architectural rules

Two, and they are the same shape: put what changes behind one door, so the rest
of the tree does not have to know it changed.

**One — the design layer must not import `astro:content`.** It reads from
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

**Two — nothing outside `src/platform/` may import a host-specific module.**
That means `cloudflare:workers`, `@fedify/cfworkers`, `node:*`, `Deno.*` — the
modules that exist in one runtime and not another.

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

**Keep it short.** A subject alone is usually enough; two or three lines of body
when the reason is not visible in the diff. The commit says why, not what — the
diff already says what, and at length it stops being read.

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
