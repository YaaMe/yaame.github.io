# Configuration

This document is for people and agents who read the code. For each setting it
says where it lives, who changes it, when it is read, and what happens if it is
wrong.

**The most important part is the interaction table in the last section.** The
meaning of one setting is easy to guess. The meaning of a combination is not.

## Overview

| Setting | Where | When it is read | Who changes it |
|---|---|---|---|
| `BUILD_PROFILE` | environment variable | before the build | CI / the deployer |
| `DEPLOY_TARGET` | environment variable | before the build | the deployer |
| `CF_KV_ID` / `CF_D1_ID` | environment variable → `wrangler.jsonc` | before the build, at deploy | CI repository variables |
| `features.*` | `src/site.config.ts`, derived from `BUILD_PROFILE` | at build time | the author (by changing the derivation) |
| `site.*` | `src/site.config.ts` | at build time | the author |
| `AP.*` | `src/integrations/activitypub/config.ts` | at build time | the author |
| `routes` / bindings / secrets | `wrangler.jsonc.template` | at deploy | the deployer |

---

## `BUILD_PROFILE`: `static` (default) or `full`

It decides which site this build produces. The two are **two products, not two
copies of one site.**

| | `static` | `full` |
|---|---|---|
| Address | `blogu.yaa.me` | `blogu.yaame.dev` |
| Host | GitHub Pages | Cloudflare Workers |
| Output | `dist/client/` only | `dist/client/` and `dist/server/` |
| `features.activitypub` / `features.auth` | off | on |
| Canonical URL | points to itself | points to itself |

Each site's footer links to the same path on the other site.

The value is read twice, in two runtimes. When Node loads `astro.config.mjs`,
it reads `process.env`. When Vite transforms the page modules, `process.env` is
gone, and the value arrives as `__BUILD_PROFILE__` through `define`.
`src/site.config.ts` reads both sources. **If it read only one, the same file
would give different answers depending on who imported it.** The canonical link
and the RSS feed would then point at different domains.

`make check` builds only the profile that `BUILD_PROFILE` names. `make both`
builds `full` and then `static`.

## `DEPLOY_TARGET`: `cloudflare` (default) or `node`

It decides two things in `astro.config.mjs`: which file under `src/platform/`
`virtual:platform` resolves to, and which Astro adapter the build uses.

The implementation that is not selected **never enters the module graph**. So
its host-only imports (`cloudflare:workers`, `node:*`) do not have to exist on
the other host. This is how the second architectural rule in `CLAUDE.md` is
implemented.

Both implementations exist:

- **`cloudflare.ts`** reads the Worker bindings `AP_KV`, `AP_DB` and
  `AP_QUEUE`, and reads secrets from the Worker environment.
- **`node.ts`** uses the `@astrojs/node` adapter in standalone mode. It stores
  records as JSON files under `AP_DATA_DIR` (default `.data`). It stores the
  database in SQLite through the built-in `node:sqlite`, at `AP_DB_URL`
  (default `.data/interactions.sqlite`). It reads secrets from `process.env`.
  It has no queue, so delivery is synchronous and a failed delivery is final.

No Makefile target and no CI job builds or deploys `DEPLOY_TARGET=node`. So
nothing checks that this target still builds.

The queue consumer in `worker/` does not read `DEPLOY_TARGET`. Its own
`worker/wrangler.jsonc` always aliases `virtual:platform` to `cloudflare.ts`.

## `CF_KV_ID` and `CF_D1_ID`

The Workers KV namespace id and the D1 database id. `scripts/wrangler-config.mjs`
puts them in place of `${CF_KV_ID}` and `${CF_D1_ID}` in
`wrangler.jsonc.template`. If any `${VAR}` in the template has no value, the
script fails.

- `make check` fills in placeholder values when they are not set. Type
  generation only needs the configuration to **parse**. It does not matter
  whether the ids are real.
- `make deploy` needs the real values. If either is missing, it fails. A
  deploy bound to the wrong KV is worse than a failed deploy.
- `make deploy` only checks that the values are present. It cannot detect a
  wrong id. With a wrong `CF_KV_ID`, the deploy succeeds and the Worker reads
  another namespace instead of its own records, such as the follower list and
  sessions.
- `make promote` and `make tombstone` need a real `CF_D1_ID`.

Neither is a secret, so CI holds them as repository variables, not secrets.
They only show that the resource exists in the account. Nobody can access
anything with them alone.

## `features.*`

`BUILD_PROFILE` decides these. You do not set them one by one.

| | Meaning |
|---|---|
| `darkMode` | the light/dark toggle button in the header navigation |
| `activitypub` | federation. Its routes are server-rendered |
| `auth` | GitHub login. Its routes are server-rendered |
| `comments` | promoted comments under a post. On in both profiles: they are read from git, not from the database |
| `search` | **`false` means it has not been built.** It does not mean "built and switched off" |

Every other route is prerendered. So **the build produces a Worker only when
`activitypub` or `auth` is on.**

## `site.*`

`title`, `author`, `lang` and `description` are plain information. Three fields
have constraints:

- **`url`** follows `BUILD_PROFILE`. It decides the canonical URL and the RSS
  links. The actor's link to the blog does not use it. That link is
  `AP.blogUrl`, which is fixed.
- **`timezone`** is the publishing time zone. Post and note dates are rendered
  in it. If a date were rendered in UTC, `02:22+08:00` would show as the
  previous day.
- **`fingerprint`** is the OpenPGP primary key fingerprint. It has 40
  characters, not 16. A 16-character key ID is a truncation of this hash, and
  the only job of this value is to be compared against another channel. No
  page reads it at present.

## `AP.*`

| | Value | Notes |
|---|---|---|
| `handleHost` | `id.yaa.me` | the part of the handle after `@`. **The protocol requires this host to serve WebFinger.** There is no indirection |
| `actorHost` | `yaame.dev` | where the actor lives. It differs from `handleHost` on purpose |
| `user` | `yaame` | |
| `blogUrl` | `https://blogu.yaame.dev` | the blog the actor points to. It is fixed, so both profiles advertise the same address |

The file also sets `discoverable`, `indexable`, `published`, `since` and
`manuallyApprovesFollowers`. The comments in the file explain each one.

Once the actor has followers, **`actorHost` cannot change.** The actor id is
stored in every follower's database. Changing it is an account migration.

When `handleHost` and the actor are on different domains, the static WebFinger
document on `id.yaa.me` must match the one Fedify generates. Mastodon checks a
second time. If the two do not match, the account is invisible on the other
server.

## `wrangler.jsonc.template`

`make wrangler` generates `wrangler.jsonc` from it. Points to know:

- **The adapter drops `routes`.** After the build, `scripts/wrangler-routes.mjs`
  puts them back into `dist/server/wrangler.json`. Without that step the deploy
  succeeds, but the custom domains are never created.
- **The Astro Worker can send to the queue, but cannot consume it.** The
  adapter's server entry point exports only a `fetch` handler. So the queue
  consumer is a separate Worker, `worker/consumer.ts`, with its own
  `worker/wrangler.jsonc`. `make deploy` deploys both.
- **`secrets.required`** lists `AP_KEY_JWK` and `GITHUB_CLIENT_SECRET`. With
  this list, wrangler refuses to deploy a Worker that is missing one. The values
  are set with `wrangler secret put`, outside the build and the deploy. Nothing
  that builds or deploys reads them.

## Interactions

| Combination | Result |
|---|---|
| `BUILD_PROFILE=static` | `activitypub` and `auth` are off. The build produces no Worker. `CF_KV_ID`, `CF_D1_ID` and `DEPLOY_TARGET` do not affect the output |
| `BUILD_PROFILE=full` without `CF_KV_ID` or `CF_D1_ID` | `make deploy` fails. `make check` still runs |
| `BUILD_PROFILE=full` with a wrong `CF_KV_ID` | `make deploy` succeeds. The Worker reads another namespace. **Nothing reports it** |
| `activitypub=true` but a route is not injected | the actor advertises an endpoint that answers 404. **Nothing reports it.** The dispatchers in `federation.ts` and `PATHS` in `src/integrations/activitypub/index.ts` must match |
| `platform.queue === false` | delivery is sent synchronously, and a failed delivery is not retried. This happens on Cloudflare when the `AP_QUEUE` binding is absent, and always under `DEPLOY_TARGET=node` |
| `DEPLOY_TARGET=node` | the build uses `src/platform/node.ts` and the Node adapter. No make target or CI job builds it |

## Not in this repository

- **The Cloudflare redirect rule** that sends every path on the apex except the
  federated ones to the blog. It cannot be middleware. Static assets are served
  before the Worker. Assets answer an unmatched path with 404, and the Worker
  is never invoked.
- **The `id.yaa.me` repository**, which serves WebFinger for the handle domain.
- **GitHub repository variables**: `CF_KV_ID`, `CF_D1_ID` and
  `CLOUDFLARE_ACCOUNT_ID`.
- **GitHub secrets**: `CLOUDFLARE_API_TOKEN` and `AP_KEY_JWK`. The `Actor key`
  workflow installs `AP_KEY_JWK` into both Workers.
- **The Worker secret `GITHUB_CLIENT_SECRET`.**
