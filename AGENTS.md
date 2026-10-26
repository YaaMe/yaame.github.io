# AGENTS.md

Before planning or editing, read [architecture](docs/architecture.md) for layer
placement and import rules. Entrances and views never import `src/persistence/`,
`src/models/`, `src/migrations/`, `src/gateways/`, `virtual:platform`,
`virtual:astro` or `astro:content`, except for the queue transport below.
Read [configuration](docs/configuration.md) for build profiles, host selection
and external infrastructure.

Keep host-specific runtime access inside `src/platform/`, reached from application
code through `src/platform/index.ts`. The queue consumer takes queue transport
directly from `virtual:platform`; its state changes go through services. A target
is either `<target>.ts` or `<target>/index.ts`, never both. Host-specific script
data access belongs in `scripts/platform/<target>/`; application rules stay in
`src/`. Protocol-required calls that are identical across hosts and deployment
configuration are outside this host-access rule.

Treat `src/content/` as the git database. For data locations, use
`src/config/data.config.json` and follow [ADR 0016](docs/decisions/0016-data-declares-where-it-lives.md)
when adding or moving data. Runtime stores and their host mappings are documented
in [configuration](docs/configuration.md#deploy_target-cloudflare-default-or-node).
Keep shipped migration SQL unchanged.

Use [`periodYear` and `chapterCount`](docs/architecture.md#what-belongs-in-the-data-layer)
through selectors for years from filenames and chapter counts; pages must not
re-derive these rules. Tags must exist in `src/config/tags.ts`; unknown tags fail
the build.

Preserve the URL contract in [ADR 0008](docs/decisions/0008-post-urls-carry-the-slug-alone.md),
[ADR 0009](docs/decisions/0009-note-urls-are-a-year-archive-and-an-anchor.md) and
[architecture's URL rules](docs/architecture.md#exception-url-shapes), including
trailing slashes, fixed note archive membership and tag pagination.

Use English for everything the repository says about itself: documentation,
code comments, commit messages and issues. Use Chinese for blog content and
reader-facing UI.

Default to no code comments. Keep only consequences, constraints the compiler
does not enforce, or explanations of an absence. Never put code history, named
call sites, section dividers or narration in comments. Put design arguments in
[decision records](docs/decisions/README.md).

Use signed Conventional Commits. Choose `feat`, `fix`, `docs`, `chore`, `ci`,
`build`, `refactor` or `test`, with an optional area scope. Keep the subject short
and state what is now true. Add a body only when the reason is unclear from the
diff.

GitHub treats any inflection of `close`, `fix` or `resolve` immediately before
`#<n>` as an issue closure, even when negated. When not closing an issue, put a
word between the keyword and number. Before posting, scan the text with
`rg -n -i '(clos|fix|resolv)\w*:?\s+#\d'`.

Stage named paths only; never `git add -A`, `git add .` or `git add -u`.
Inspect `git diff --cached --stat` before committing. `docs/identity.md` and
`komorebi-notes.md` are deliberately gitignored and may be absent in a fresh
checkout. Never stage them.

Work normally lands directly on `main`; a pull request is optional. When landing
a feature branch, update `main` with `git pull --ff-only`, then merge locally with
`git merge --no-ff --gpg-sign`. Never force-push `main` or use GitHub's
"Rebase and merge".

Run commands from the repository root. [Makefile](Makefile) owns the operations;
`make help` lists them. CI uses Node 24.22.1; `make install` runs `npm ci`.
[deploy.yml](.github/workflows/deploy.yml) runs `make check` with
`BUILD_PROFILE=static`; [workers.yml](.github/workflows/workers.yml) runs
`make deploy`, which checks `full`.

| When | Command |
| --- | --- |
| Check the selected profile (`static` by default) | `make check` — Wrangler configuration/types, frontmatter, data register, type check, build, tests and internal links |
| Before pushing | `make both` — checks `full`, then `static` |
| Validate data locations and generate their consumers | `make data` |
| Run offline behavior tests | `make test` |
| Check frontmatter without editing content | `make frontmatter` |
| Check types | `make types` |
| Check internal links after building | `make links` |

If platform or build wiring changes, also build both profiles with
`DEPLOY_TARGET=node BUILD_PROFILE=full make build` and
`DEPLOY_TARGET=node BUILD_PROFILE=static make build`. These Node builds are local
self-checks; CI does not run them.
