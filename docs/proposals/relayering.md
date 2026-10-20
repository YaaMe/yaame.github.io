This body is the current design and is edited in place.

Proposal: re-layering the blog. The owner approved its Decision on 2026-10-21; a decision record (0018) is to record it. Its review status appears at the end.

## Decision

### Data story

The design preserves the blog's data across a change of presentation, framework, or host. Code placement changes who reaches a store, not which store owns a fact.

**Inventory evidence, today's tree:** `src/data.config.json:1` is the existing data register. Its entries name locations, origins, recovery policies, and write-back operations. The table below cites that register rather than creating a second location register. “Raw” means an authored input, received value, or observed event. “Derived” means a computation from those inputs. A received value can be untrusted and still be raw.

The location column describes **today's declarations**, not inspected production contents. The ownership column describes the **target design**. The register moves to `src/config/data.config.json`; its SQL names, record keys, and content paths stay stable.

| Data and classification | Canonical location and other copies — today's declarations and code | Target readers and writers |
| --- | --- | --- |
| Posts, pinned choices, notes, and the novel: raw authored text, metadata, identifiers, and archive membership. Parsed dates, rendered HTML, tags in use, chapter counts, archive groups, and URLs: derived. | Git under `src/content/`; register `src/data.config.json:2`, `:15`, `:28`, `:41`. Astro collection records and generated pages are runtime/build copies. Read and render implementations: `src/lib/posts.ts:18`, `:98`, `:106`; `src/lib/notes.ts:33`. | Content persistence reads through `virtual:astro`. Selectors shape the results for pages, views, RSS, and ActivityPub. Authoring services validate and prepare changes; root scripts carry out the owner's filesystem/Git procedure. |
| Site settings, tag registry, ActivityPub settings, login settings, follow intent, and the data register: raw owner choices. Profile flags, generated location exports, and display labels assembled from them: derived. | Git; `src/data.config.json:54`, `:328`, `:341`, `:354`, `:367`; register schema at `src/data.config.ts:33`. Generated `.mjs` and `.d.ts` files are copies made by `scripts/data-config.mjs:7`. | Any band may read configuration. The owner and configuration-editing services change the choices through operations. The generator derives consumer files. A role decision belongs in a service even when its inputs are configuration. |
| Visitor identities, comments, reactions, and followers: raw received identity/activity/object identifiers, content, addresses, and observed timestamps/state changes. UUIDs, normalized identifiers, thread roots, reply links, targets, and counts: derived. A fetched display name is an optional received snapshot. | SQL tables declared at `src/data.config.json:67`, `:224`, `:264`, `:293`. D1 is the Cloudflare store; Node uses SQLite through the same platform contract (`src/platform/cloudflare/index.ts:45`; `src/platform/node/index.ts:34`). | Interaction services own recording, withdrawal, and follower changes. Interaction selectors own reads and counts. Persistence executes SQL; models own row shape and key derivation. The owner can import/export through recovery services. |
| Promoted comments: raw owner selection and the committed public archive; transformed content runs and the visible withdrawal overlay: derived. A remote name copied at promotion is a received snapshot, not a live identity authority. | Git base plus SQL `deletedAt` delta, joined by comment id: `src/data.config.json:311`. The full-profile read combines them at `src/lib/interactions/comments-live.ts:5`. Proposal branches are proposed edits, not the canonical base (`scripts/promote.mjs:126`; `scripts/tombstone.mjs:81`). | Promotion/tombstone/unpromotion services plan changes. Scripts own Git, PR, file, and command procedures. Selectors read the base and applicable delta without acknowledging or writing it. Views render the resulting value. |
| Following acceptance and the follow ledger: raw observations of remote acceptance and local follow handling, including the resolved actor received from lookup. They cannot be reconstructed from current intent alone. | KV records `ap:following` and `ap:follow-intent`; `src/data.config.json:88`, `:101`. Node's equivalent is JSON files (`src/platform/node/index.ts:38`). | Following services read intent and ledger, reconcile, and record replies. Following selectors expose the collection. Record persistence owns the keys and get/put operations; outbound gateways own lookup and delivery. |
| Delivery marks and failed-delivery/departure observations: raw local bookkeeping. A mark is a local suppression/handover fact, not proof of remote receipt. | SQL delivery marks; KV failure/departure records: `src/data.config.json:114`, `:145`, `:158`. Process-local `sentUnmarked` holds an additional handover observation (`src/integrations/activitypub/delivery.ts:34`). First-run marks can be written without sending (`:66-68`). | Publishing/delivery services own marks and retries of marking. The consumer delegates failure recording and pruning to services. Departure signals record diagnostics through record persistence. Operations read them through middle-band interfaces. |
| Actor and note digests: derived fingerprints with historical significance. The last fingerprint is not recoverable from current content after an edit. | KV records; `src/data.config.json:132`, `:171`. Today comparisons control announcements (`src/integrations/activitypub/federation.ts:71`; `src/integrations/activitypub/outbox.ts:186`). The register says note digests are kept and the actor digest rebuilt. | Signals compare change state and call outbound gateways; record persistence reads/writes their checkpoints. Preserve ADR 0003's fingerprint policy and its failure tradeoff. O12 asks whether later work needs stronger recovery evidence. |
| Session records, random session credentials, OAuth state/verifier, and received GitHub user identity: raw issued/received facts with a limited lifetime. Roles, active/expired results, and the displayed login: derived. | Session KV keys and browser cookies; `src/data.config.json:184`; `src/integrations/auth/session-core.ts:12`, `:19`. GitHub's access token is local to the callback function (`src/integrations/auth/routes/callback-handler.ts:91`). | Auth entrances parse credentials and run request checks. Session/login services decide and create/revoke sessions through record persistence. The renderer requests its session through the service and passes display props. Personal results stay out of shared HTML/cache entries. |
| Migration history and applied-version records: raw shipped schema instructions and observed application bookkeeping. Bootstrap SQL assembled from that history: derived. | Shipped `src/integrations/activitypub/store/migration-history.ts`; SQL register entry `src/data.config.json:248`; runner `src/integrations/activitypub/store/schema.ts:179`, `:199`. | Migration services invoke the migration runner. Recovery reads and preserves applied versions. Persistence uses the resulting database. Code relocation leaves shipped statements and their order intact. |
| Fedify caches and deduplication memory, queue tasks/attempt counts, and queue ordering locks: mixed data. Cached remote responses and host-reported attempts are raw observations; cached projections are derived. Queue payloads are derived from submitted activities; acceptance and lock/attempt transitions are raw operational facts. | Memory and host-owned facilities: `src/data.config.json:198`, `:210`; `src/platform/cloudflare/index.ts:28`, `:39`; `worker/wrangler.jsonc:33`; `worker/consumer.ts:90`. These are not a second canonical interaction database. | Fedify and the platform own their internal keys. The consumer reads transport state and invokes services. Services/gateways submit work. Application deduplication continues to use stored interaction identifiers and delivery marks. |
| Secrets, deployment identifiers, deployment source configuration, WebFinger configuration, and the redirect rule: raw owner/operator inputs. Generated Wrangler configuration and route manifests: derived. | Register entries `src/data.config.json:380` through the end name these sources without containing secret values. Tracked deployment templates/configuration, operator-controlled environments, and external owner-controlled configuration are the authorities. | The operator supplies secrets and deployment choices. Bottom-band adapters obtain runtime secrets through the platform. Build/deploy operations generate configuration; application services do not edit deployment state. |
| Recovery documents, snapshots of stores, fetched Git refs, and command outcomes: observations of a source at a point in time. Selection plans, write plans, and summaries: derived. | Recovery document shape/version at `src/lib/recovery.ts:8`, `:37`; snapshot/ref readers at `scripts/comments-store.mjs:45` and `scripts/platform/node/sqlite.mjs:17`. Exported documents are portable snapshots, not live stores. | Recovery services validate and plan; host adapters read/apply. Operators hold exports. Promotion/tombstone services consume supplied main/proposal snapshots. A preview cannot become an acknowledgement of a write. |

**Target retention and rebuild rule:** keep raw data. Derived values may be recomputed from retained sources; losing them must not lose information. A public archive, delivery ledger, or historical checkpoint is not disposable merely because some fields are computed. The repository's explicit retention and announcement policies below take precedence where they conflict, as the data-story standard requires.

**Existing repository policy and today's code:** withdrawal clears SQL comment text (`docs/interactions.md:190`; `src/integrations/activitypub/store/comments.ts:94`). Explicit unpromotion can remove the archive entry and its SQL row (`docs/interactions.md:310`; `scripts/unpromote.mjs:69`). Sessions expire or are revoked (`docs/interactions.md:334`; `src/integrations/auth/session-core.ts:141`). Recovery deliberately excludes reset/ephemeral data (`docs/recovery.md:162`). Departure diagnostics are capped (`src/integrations/activitypub/federation.ts:116`; `src/data.config.json:158`). These declared lifecycle policies qualify retention; the design preserves them. It does not claim every received byte remains available or add a hidden archive of withdrawn text or credentials.

**Target dependencies:** where repository policy is silent, gates, keys, stop rules, and start conditions depend only on raw data, with its source named. ADR 0003 explicitly uses fingerprints to trigger announcements and writes checkpoints before sending (`docs/decisions/0003-the-actor-announces-itself-when-it-is-built.md:20`, `:46`). That repository-specific rule takes precedence; it does not turn fingerprints into raw data. The dependency chains are:

| Decision or output | Raw source; derived work allowed on the path | Boundary and cost |
| --- | --- | --- |
| Interaction identity and deduplication | Received source, signer, activity/object identifiers; stored UUID namespace/configuration. UUIDs index those retained inputs. Delivery identity uses channel and content identifier. | No live remote lookup is needed to recompute a key. Preserve the tuples and normalization contract; today's implementation is `src/lib/interactions/key-scheme.ts:3`, `:74`. |
| Session validity and role | Stored expiry/user id, presented credential, injected time when expiry is decided, and owner/allow-list settings. | Personal store access can fail. A cleanup failure cannot make an expired session valid. Today's separation is recorded in C1. |
| Publication, following, promotion, withdrawal, and recovery decisions | Git content/intent/base, received signed values, stored marks, raw store snapshots, observed proposal-ref contents, and explicit operator input. | Derived counts, visible lists, or proposal labels cannot replace the source records. A following collection cannot substitute for the sent-follow ledger. |
| Whether an actor or content announcement is needed | Owner configuration/content produces an actor/note representation; its fingerprint is compared with the stored checkpoint. This is the explicit ADR 0003 exception to raw-only control inputs. | **Today's cost:** the earlier source representation is not retained with the fingerprint, and the checkpoint is written before sending. It proves neither remote receipt nor a reconstructible history. Preserve this policy during relocation; O12/B10 cover any later stronger recovery guarantee. |
| Migration readiness and implementation acceptance | Shipped migration statements, applied-version rows, source files, command exit statuses, and inspected artifacts. | A source scan says only what it inspected. A successful build does not establish production delivery or Node deployment behavior. |

The retained outside dependencies are GitHub login, remote ActivityPub actors/inboxes, the selected host's storage/queue, and owner-operated deployment/identity infrastructure. GitHub can deny or fail login. A remote actor can change its profile or disappear; a send can fail after local state changed. Host outages can prevent reads, writes, or delivery. The owner must confirm these costs for the implementation scope under O11. This design introduces no new live source to make placement decisions. Optional remote names remain optional display data.

Design evidence is local and pinned below. The supplied decisions are the authority for the target. Local source observations establish today's behavior; they do not establish production contents or tracker state.

### Layering

Entrances and views sit side by side above the middle band. Entrances translate an event into a use case. Views render data; a view may obtain it directly from the middle band.

```text
entrances                                      views
  src/pages/        static pages                 src/components/  islands included
  src/routes/       handlers                     src/layouts/
  src/pages-extra/  full-profile pages           src/styles/
  worker/consumer.ts
  scripts/ and Makefile at repository root
  edges: src/params/, src/schemas/
                         │
                         ▼
middle
  src/services/     writes, decisions, use cases
  src/signals/      reactions to data changes
  src/selectors/    reads shaped for callers
                         │
                         ▼
bottom
  src/persistence/content/       git-content access
  src/persistence/interactions/  D1/SQLite access
  src/persistence/records/       KV/record access
  src/models/                   tables, row schemas, keys
  src/migrations/               history and migrate()
  src/gateways/                  calls out
                         │
                         ▼
boundary
  src/platform/       host, through virtual:platform
  src/astro.binding.ts framework, through virtual:astro
  src/content.config.ts git schema at Astro's required path

available across the tree
  src/config/   owner settings
  src/lib/      abstract neutral logic; imports none of these application bands
  src/content/  git database files; access still follows the layers
```

Imports point downward, one band at a time. Entrances and views reach services/selectors. The middle reaches the bottom; the bottom reaches the boundary. Within the middle, services may call selectors; selectors never call services. Signals belong to the middle by meaning. Input parameters and response schemas are edges of the entrances.

The blog uses strict band traversal. O1 carries the possible pass-through exception for an explicit owner answer. Until then, a thin middle-band interface is still the public application interface. The queue consumer has the documented transport exception: it obtains queue transport through `virtual:platform`; application state changes still enter services.

A page and a server-island component perform the router role: parse, delegate, render. A component used by only one page lives under its feature in `src/components/`, never beside its route. Pure views render supplied values. Other components and layouts may call services or selectors directly, including writes.

A page that exists only in the full profile belongs to its own page group, separate from static pages under `src/pages/`. The full profile alone injects that group. `src/routes/` holds handlers only. That group is `src/pages-extra/`, one subdirectory per functional unit that has such a page (for example `src/pages-extra/auth/`). It holds only HTML pages registered by configuration and included only in the full profile; Astro does not file-route it. No such page exists in the target today, so the directory is created with its first page.

The target design has no login page. B11 removes `/login` as a separate behavior change; relocation preserves it until then. O14 chooses where a failed login's reason appears.

A write needing uniform authentication, CSRF handling, a transaction, or logging enters through an entrance. Authentication and CSRF checks run at that entrance. The service owns business decisions and the transaction.

A request exposes a public endpoint; props are an internal interface. Open a request only for data that exists only at request time. The renderer reads the signed-in identity through a service and supplies props to its children. Session identity has no endpoint of its own and no middleware-populated `Astro.locals` slot. A component does not earn its own route.

Server islands are views under `src/components/`. Astro's single framework-owned route, `/_server-islands/[name]`, serves them. There is no application island route file or `src/routes/islands/` directory to add. The model resembles a React Server Component: the island reads request-time data through the middle and renders pure views. This comparison does not adopt React or its runtime. An island is written like a React Server Component, but it runs as its own deferred request: it does its own checks and sets its own cache headers, and it renders once and does not refresh.

Full/static component aliases remain view composition, including `virtual:session-bar`, `virtual:comments-section`, and `virtual:note-comments`. Views may import rendering modules such as `astro:assets` and `astro:transitions`. Views do not import `astro:content`, including type-only imports.

Git content is a database alongside D1. Its query API is `getCollection`. Content persistence reaches that API through `virtual:astro`, resolved to `src/astro.binding.ts`. The consumer resolves the alias to a stub that refuses content reads.

A read path does not write. Stale state found by a read is reported and cleaned up by a separate service call.

Services decide; selectors prepare what callers display. A redesign may add a selector or wrap existing selectors. It preserves each existing selector's output contract; fields, meanings, ordering, and URLs are examples. Models own tables, row schemas, and keys; cross-row decisions belong above them. Persistence owns data access, and gateways own outbound protocol calls.

Signals are reactions to changes in data, whether triggered by a hook or an explicit call. Actor/content announcements and follower-departure diagnostics are examples. The underlying change can succeed without the reaction. O4 distinguishes that fact from the surrounding request's success and retry contract.

ActivityPub and auth are backend features spread across these layers. Their application logic has no Astro dependency. Astro integration objects and dynamic-route hooks perform framework wiring only; O2 chooses their location.

Generic path-template encoding and decoding belongs in `src/lib/` and knows nothing of ActivityPub. The site's AP object-id scheme belongs in `src/models/activitypub/object-id.ts`: `/users/{identifier}/notes/{slug}`, `objectUrl`, and `contentIdentifierOf`. It uses the neutral codec and receives host and user as values from `src/config/`. Every already-published id must still decode. The Fedify dispatcher, decoder, publication probe, and injected Astro route use this scheme. Routes reach its template through the middle band; Astro pattern conversion remains framework wiring. Object constructors receive content URLs from selectors. The `/posts/{slug}/` and `/notes/{year}/#{id}` contracts belong to those selectors.

Root scripts and the Makefile are operational entrances. They call application rules rather than reimplementing validation, identifiers, visibility, or transitions. Prompts, command invocation, Git/PR procedures, file/stdin/stdout handling, and deployment setup remain root operations. Host-specific operational adapters remain under `scripts/platform/<target>/`; O8 defines their precise access boundary.

Inject time only where a rule decides by it. Merely recording a timestamp does not require a clock abstraction. Followers keep their own atomic identity-plus-follower upsert. The proposal and ADR do not complete issue #73; its interaction-store relocation changeset does.

## Current state

**Today's code, inspected locally on October 21, 2026, Asia/Singapore:** `main` at `3eac3ae091bed82644fdbf7ecdca6b142953a8ef`. The target documents are uncommitted. They describe the intended structure, not an implemented tree. The source evidence below refers to this baseline. Issue #73's open status and remaining scope come from the owner's brief, not a live tracker query.

The target document SHA-256 values at inspection were:

- `CLAUDE.md`: `ac858fd1d22d73ab3dbfb194a8f92f8973f91ca6e68d3e65209d16ab12ebecd2`.
- `docs/architecture.md`: `4b0fabe96555c08535adaae4558e1e0510f2a80a0e12f7c73e4ddaabc31d5840`.

| Ref | Today's code and evidence | Difference from the target, or contract already satisfied |
| --- | --- | --- |
| C1 | `src/integrations/auth/session-core.ts:131` reports absent/expired/active and only calls `get`. `src/services/session.ts:62` calls it, then separately discards an expired record. Cleanup failure is caught at `:51`. Tests assert read purity, exact-key cleanup, and safe failure logging at `tests/auth.test.mjs:266`, `:357`, `:369`. | The session read/cleanup separation is already implemented in `3eac3ae`. Remaining work is placement: cookie parsing, role resolution, record keys, and platform access still span the old modules. Do not implement expiry deletion again or weaken its failure behavior. |
| C2 | `src/components/session/server.astro:2` imports `current()` from `src/services/session.ts`; `:5` sets `private, no-store`; `:6` reads the session and `:8` renders `Panel`. | This already demonstrates the target server-island model. Keep the island in components. Its service currently accepts a `Request`; transport parsing can be separated without global session resolution. |
| C3 | Installed Astro is 7.3.6 (`node_modules/astro/package.json:3`). `node_modules/astro/dist/core/server-islands/endpoint.js:11` defines the route, `:18-29` marks it internal/non-prerendered, and `:33` injects it. `src/integrations/dynamic-routes.ts:27` records resolved framework routes. | Framework-owned routing is verified from installed source. No application route per island is needed. This dependency observation is version-specific. |
| C4 | `src/lib/posts.ts:1`, `src/lib/notes.ts:1`, and `src/lib/interactions/comments.ts:1` import `astro:content`. The same modules sort, flatten, derive dates, URLs, and visibility. | Content query access and selector logic share modules in `lib/`; there is no framework binding in these paths. Split access from shaping, then relocate. |
| C5 | `src/lib/interactions/comments-live.ts:2` reaches the ActivityPub comment store. `:13` batches withdrawals, but `:18` calls `commentsFor` for every root. `src/components/comments/server-notes.astro:9` filters notes by year. | The read can retain its results and call pattern while gaining persistence/selectors. Year selection belongs in a selector. Collection caching and reduced repeated reads are separate performance changes. |
| C6 | `src/pages/index.astro:18` sorts filename periods and `:21` groups years; `:28` starts page markup. `src/pages/posts/[slug].astro:16` renders article markup and `:21` builds tag links. `src/pages/notes/index.astro:7` chooses the latest window. | Pages mix transport, data preparation, and views. Extract named selector projections and feature components while preserving paths and output. |
| C7 | `src/components/PostList.astro:6` constructs pagination URLs. `src/components/Comments.astro:4` imports the comment schema and `:15` prepares dates/URLs. `src/layouts/Base.astro:10` constructs the canonical URL, `:14` formats the fingerprint, and `:4` imports the session alias. | Move application/display preparation into selectors. The layout's component alias and view-to-view composition are permitted; they need no route-owned fragment or slot detour. |
| C8 | `astro.config.mjs:18` chooses session/comment components by profile; `:65` defines the host and component aliases. `src/components/comments/notes-full.astro:15` creates one deferred renderer, then `:28` places its sections into note slots. | Preserve profile isolation, one notes-comments island per year page, note anchors, and placement behavior. Alias destinations remain components. |
| C9 | `src/integrations/activitypub/store/comments.ts:26` mixes parent lookup with root selection; `:49` decides whether to record; `:94` withdraws; `:106` starts reads. `store/reactions.ts:17` checks content ownership and derives keys. `store/followers.ts:11` normalizes and writes. | The interaction store contains use cases and reads as well as persistence. Split rules into services, read shaping into selectors, and SQL into persistence before the store relocation. |
| C10 | `store/database.ts:15` under `src/integrations/activitypub/` caches readiness and calls `migrate()` at `:20`. `store/schema.ts:31` declares tables and `:199` runs migrations. `store/migration-history.ts:1` is separate history. | Tables, runner/history, and persistence need distinct homes. A nominal read can initialize/mutate schema through `store()`; O10 addresses that remaining read-path effect. |
| C11 | `src/integrations/activitypub/store/identity-write.ts:29` writes the identity before a separate interaction insert. `store/follower-rows.ts:41` uses `db.atomic` for the identity and follower. `store/query-batches.ts:3` hardcodes a 100-parameter budget. | Preserve both write contracts. Followers retain their dedicated atomic upsert. O3 chooses how to represent the database limit; the code's constant is not a fresh claim about Cloudflare's current service limits. |
| C12 | `src/integrations/activitypub/federation.ts:42` constructs Fedify; `:71` announces actor changes; `:118` records departures; `:197` reconciles following; `:258` starts dispatcher registration; `:332` reads signing material; `:358` registers inbox listeners. | Runtime setup, reads, business decisions, protocols, storage, and reactions share one module. The split must retain one runtime instance per entrance process without service-to-route imports. |
| C13 | `src/integrations/activitypub/outbox.ts:80` builds the timeline; `:98` constructs protocol output; `:159` publishes; `:186` announces edits; `:233` registers a dispatcher. The dispatcher slices at `:236`, publishes at `:258`, reconciles following at `:261`, and announces edits at `:262`. | Split selectors, schemas/protocol adapters, services, signals, and registration. A GET dispatcher currently orchestrates writes. Moving its read into a selector must not move those writes with it. `AP.published` also constrains delivery candidates today. |
| C14 | `src/integrations/activitypub/federation.ts:79` compares/writes a digest before sending; `:319` awaits the announcement. `:139` awaits departure records after pruning. `src/integrations/activitypub/outbox.ts:208` persists digests before sending edits. | Signals are awaited today. Best-effort responses, durable retries, and raw-source checkpoints change behavior and belong in separate changesets. |
| C15 | `worker/consumer.ts:17` imports the platform; `:82` writes failure records; `:114` invokes Fedify; `:133` prunes followers. The never-ready path records then acknowledges at `:109` without pruning. | Keep queue readiness, ack/retry, decoding, and the retry curve at the entrance. Move application failure recording and queued-delivery use cases behind services. Preserve the distinction between never-ready and failed delivery. |
| C16 | `src/integrations/auth/session-core.ts:24` parses cookies, `:42` emits attributes, `:45` forms record keys, and `:131` reads/evaluates sessions. `src/services/session.ts:35` writes directly to the platform. `src/integrations/auth/routes/callback-handler.ts:81` checks state and `:93` calls GitHub. `routes/callback.ts:11` supplies platform secrets. The auth integration injects `/login` at `src/integrations/auth/index.ts:11`; failed callbacks redirect there at `src/integrations/auth/routes/callback-handler.ts:70`. | Auth needs edge parsing/output, service decisions, record persistence, and a GitHub gateway. Preserve state/PKCE ordering, cookie attributes, refusals, and redirects during extraction. B11 separately removes the login page and changes the failure destination after O14. |
| C17 | `src/integrations/activitypub/index.ts:39` and `src/integrations/auth/index.ts:17` are Astro integration factories. `src/integrations/dynamic-routes.ts:22` owns build hooks. `astro.config.mjs:43` installs them conditionally. | These are framework wiring. Their current parent directories also contain backend code; that does not make the backend Astro integration logic. O2 chooses the wiring's final home. |
| C18 | `scripts/promote.mjs:60` validates archive entries, `:72` builds SQL, `:98` fetches actor names, and `:132` computes promotion state. `scripts/tombstone.mjs:44` rewrites withdrawals. `scripts/comments-store.mjs:108` decides archive placement and `:121` validates before file writes. | Operations contain application rules and outbound access. Extract those rules while retaining command, filesystem, Git-ref, and PR mechanics in root scripts. |
| C19 | `scripts/notes-store.mjs:37` generates identifiers. `scripts/newpost.mjs:79` chooses the previous month and `:101` classifies a post. `scripts/note.mjs:59` converts a file; `:68` decides whether the published-post checks apply. `scripts/promote-filter.mjs:59` is the owner's executable policy interface. | Extract authoring decisions into services. Preserve existing path-form and validation behavior until its separate change. O6 chooses the policy-editing interface. |
| C20 | `src/data.config.ts:2` imports recovery for key-pattern validation. `scripts/data-config.mjs:10` infers the root from the register's depth. `scripts/data-check.mjs:47` assumes generated imports are relative to `src/`; `:191` through `:196` require record access in old feature/worker files. | Extract neutral grammar before moving recovery. Relocation must update generators and checkers together, including source-string assertions and exemptions. Passing a stale checker is not acceptance. |
| C21 | `scripts/recovery-plan.mjs:9` refuses nonempty destinations. `src/lib/interactions/records.ts:168` validates cross-row references. `scripts/platform/cloudflare/d1.mjs:7` imports bootstrap SQL; `scripts/platform/node/sqlite.mjs:8` imports migration execution and `:58` wraps import population in a transaction. | Recovery decisions belong in services; row schemas in models; statement construction in persistence. O8 separates service policy from host execution and transaction mechanics without duplicating rules. |
| C22 | `tests/fixtures/inbox.mjs:16` embeds imports in a generated bundle entry. `tests/tombstones-workflow.test.mjs:16` copies explicit source paths. `Makefile:51` runs the check pipeline. `.github/workflows/deploy.yml:31` checks static output; `.github/workflows/workers.yml:39` runs deployment with the full profile. | Every move must include bundle strings, copied-file lists, and checker paths. Consumer deployment currently follows site deployment (`Makefile:37`); a separate pre-deploy consumer build gate would change assurance. Node acceptance is not enforced by those workflows. |
| C23 | `src/content.config.ts:10` imports the shared comment schema and `:81` registers it with Astro. | Moving that schema to `models/` exposes a boundary-to-model wiring question. O13 must settle the registration mechanism without copying the schema or hiding an upward dependency. |
| C24 | The AP object-id scheme appears in the Fedify template at `src/integrations/activitypub/outbox.ts:302`, `CONTENT_PREFIX` and its decoder at `src/lib/interactions/records.ts:13,21`, the probe at `scripts/note.mjs:115`, and Astro wiring at `src/integrations/activitypub/index.ts:22`. `src/integrations/activitypub/outbox.ts:99` obtains ids from Fedify's actual `ctx.getObjectUri`. | One model owns the scheme. Steps 4–5 separate and relocate the decoder; step 10 shares the template/codec and verifies Fedify equality before replacement. Step 14 redirects the probe. Content URLs remain selector outputs. |

`store/...` abbreviations in C10 and C11 are relative to `src/integrations/activitypub/`.

No builds, tests, generators, deployment commands, or tracker writes ran for this draft. Only `docs/proposals/relayering.md` is editable for this revision. The acceptance commands below are a plan, not observed green results.

## Implementation

### Conventions this plan applies

These are implementation conventions, separate from the owner's settled decisions. A page template passes values to a layout or component. Markup and styles belong to views. Transport responses and error/status mapping stay at the edge.

Public content may render at build time. Personal data stays out of prerendered/shared HTML. A server island fills its request-time slot with a private response.

Content persistence also renders through `virtual:astro`. Below entrances, the binding and Astro's fixed `src/content.config.ts` own content-framework imports, subject to O13's registration wiring. Importing the consumer stub succeeds; attempting a content read or render throws. The stub does not substitute an empty collection.

**Plain-Node rule:** scripts run under plain Node and cannot resolve `virtual:platform` or `virtual:astro`; a script-facing entry must not pull either, even transitively. **Check:** import each script-facing entry under plain Node.

### Plan v3: changeset contract

The ordered steps below are future changesets. Each includes its callers, tests/fixtures, build wiring, checkers, and applicable documentation. It must pass its acceptance checks before the next changeset starts. Intermediate commits may retain a documented placement gap; none may depend on a later commit merely to build.

“Split” extracts responsibilities and preserves behavior. “Relocation” moves already separated modules and changes references only. Behavior changes appear in B1–B13 below and never ride with either category. A temporary forwarding export may keep an intermediate commit working; its stated relocation step removes it. Each step names any temporary upward or cross-band import it leaves and the step that closes it.

Before implementation, record the approved ADR and the baseline source/document revisions. Run baseline checks in a writable implementation checkout. Existing failures need a recorded disposition before a changeset can claim to preserve a green build. Issue #73 remains a separate open item until step 5 lands; earlier helper extraction is already baseline work.

Every executable changeset runs the relevant focused tests, followed by this acceptance matrix:

```sh
BUILD_PROFILE=full DEPLOY_TARGET=cloudflare make check
make build-consumer
BUILD_PROFILE=full DEPLOY_TARGET=node make build
BUILD_PROFILE=static DEPLOY_TARGET=node make build
BUILD_PROFILE=static DEPLOY_TARGET=cloudflare make check
```

Full Node matters because static Node alone does not exercise the runtime graph. Static Cloudflare runs last to leave normal static output. These are implementation self-checks until CI enforces them. They do not make a claim about deployed services. O7 decides which additional checks become gates. A new gate must run quickly without network access and state exactly what it inspected.

### 1. Split neutral register grammar from recovery

Extract `recordKeyPlaceholders`, `isRecordKeyPattern`, `recordKeyMatches`, their regex, and escaping helper into `src/lib/key-pattern.ts`. Redirect the register schema, generator, checker, and recovery callers. Keep recovery errors, selection, validation, and policy in their current module for now. SQL quoting is not neutral string logic and is not moved into this library.

**Acceptance:** register/key-pattern tests retain valid/invalid placeholder and matching behavior. Invalid register diagnostics keep their meaning. `src/data.config.ts` no longer imports recovery; the new library imports no application band. Run the matrix.

### 2. Split role decisions from auth settings

Extract `roleOf` into `src/services/auth/roles.ts`. Leave `AUTH` and its policy inputs in configuration. Redirect session and test callers together. Expose role result types through the middle-band interface where entrances need them.

**Temporary imports:** the new role service still reads `src/integrations/auth/config.ts` until step 3 relocates configuration. `src/integrations/auth/session-core.ts` calls the new role service until step 8 splits that mixed module into edges, services, and persistence.

**Acceptance:** auth tests cover owner, allow-listed, and guest identities. Role changes still apply on a later session read. No session key, cookie, or lifetime changes. Run the matrix.

### 3. Relocate configuration

Move the site configuration, tags, ActivityPub settings, auth settings, follow intent, register, and register schema into `src/config/`. Regenerate the location module and declaration there. Update all imports, generated headers, `.gitignore`, register paths, and owner-facing editing instructions.

Fix the generator's project-root calculation for the deeper directory. Compute generated follow-intent imports relative to the generated module. Replace scripts' hardcoded `src/tags.ts` and ActivityPub configuration paths with the register's `tags.file` and `apConfig.file`. This covers tag listing/creation, post creation, and the note publication probe. Update source-reading scripts, workflow inline imports, test fixture copies, and data-check assertions in the same changeset. Only configuration paths change; content paths, SQL names, record keys, and recovery version remain fixed.

**Acceptance:** `make data` is repeatable; generated exports resolve the registered locations. Generator/mutation tests fail on deliberately wrong locations and pass with the moved ones. Both promotion/tombstone workflow fixtures use the new generated path. Run the matrix.

### 4. Split interaction rules, reads, schemas, and migration execution

Separate the mixed store files before moving their remaining persistence modules. Introduce service and selector interfaces at their target paths, with the existing store modules forwarding temporarily where needed.

| Responsibility | Split destination |
| --- | --- |
| Comment recording/withdrawal, reaction recording/undo, follower changes | `src/services/interactions/{comments,reactions,followers}.ts` |
| Parent/thread interpretation and caller-facing thread, withdrawal, reply, reaction, follower reads | `src/selectors/interactions/`; SQL stays behind persistence functions |
| `validateInteractionReferences` across a recovery set | `src/services/recovery/interaction-references.ts` |
| Table declarations versus `schemaBootstrapStatements`/`migrate` | Separate modules within the old store until step 5 |
| `storedIdentity`, `deliveryRow`, row validation versus database operations | Separate model-only and persistence-only modules within the old store until step 5 |

Separate `CONTENT_PREFIX` and `contentIdentifierOf` from row-schema logic for step 5's AP object-id model. Preserve the existing prefix/format decoding during this split. A content lookup would alter acceptance and make the consumer depend on Astro content. Preserve SQL predicates, ordering, parameter reservations, and the two-statement comment/reaction insertion. Keep follower upsert atomic and separate.

Add `src/services/interactions/schema.ts`, exposing `schemaBootstrapStatements` and `migrate(database)` over the separated bootstrap/runner. Keep existing host execution and transaction order. Apply the Plain-Node rule under Conventions; supply host execution through explicit inputs. Step 5 redirects the operational callers and the service's bottom-band dependencies. B13 later removes its request-path caller; the operational callers remain.

**Temporary imports:** old store forwards reach the new services/selectors, which still reach separated persistence/model modules under the old store. This includes `src/services/interactions/schema.ts` reaching the separated old bootstrap/runner. `scripts/platform/cloudflare/d1.mjs:7` and `scripts/platform/node/sqlite.mjs:8` still import `store/schema.ts` directly until step 5 redirects both to the service. Step 5 closes those location gaps. `src/lib/recovery.ts:6` reaches `src/services/recovery/interaction-references.ts` until step 12 moves recovery into services. `src/lib/interactions/comments-live.ts` reaches the new interaction selectors through the old store forward until step 5, then directly until step 7.

**Acceptance:** interaction keys, comment/reaction writes, follower writes/inbox handling, stored-row validation, batching, and recovery-reference tests pass. Exercise rollback for follower upsert and the existing partial-write contract for other interactions. Run the matrix.

### 5. Relocate the interaction store and complete its remaining #73 scope

Move the separated modules and remove temporary store forwards:

| Source family | Target home |
| --- | --- |
| `lib/interactions/key-scheme.ts`, row schemas/validation, model-only identity/delivery/stored-row helpers, Drizzle tables | `src/models/interactions/` |
| Separated `CONTENT_PREFIX`/`contentIdentifierOf` from `lib/interactions/records.ts` | `src/models/activitypub/object-id.ts`; step 10 replaces the prefix implementation with the shared template codec while preserving decoding |
| Comment archive schema | `src/models/content/`, subject to O13's registration wiring |
| `store/migration-history.ts`, separated bootstrap/runner | `src/migrations/history.ts`, `src/migrations/index.ts` |
| Database access, SQL comment/reaction/follower/delivery reads and writes, batching, identity insertion | `src/persistence/interactions/` |
| `store/sql-text.ts`'s `sqlValue` | `src/persistence/interactions/sql-text.ts`; step 12 adds `quoteSqlIdentifier` to this same module |

Update federation/outbox callers to the service/selector APIs from step 4. Service decoder callers use `src/models/activitypub/object-id.ts`; keep row schemas under interaction models. The remaining federation entrance reaches the decoder through a pure forward at `src/selectors/activitypub/objects.ts`. Step 10 adds the template and constructor exports to that interface; O1 records why it stays. Update direct test imports, the inbox fixture's generated entry, copied-file manifests, data-check's table/runner assertions, and migration-history exemptions. Redirect `scripts/platform/cloudflare/d1.mjs` and `scripts/platform/node/sqlite.mjs` from `store/schema.ts` to `src/services/interactions/schema.ts`. That service now calls `src/migrations/index.ts`; concrete host execution remains operational work.

**Temporary imports:** `src/lib/interactions/comments.ts` and `src/lib/interactions/comment-runs.ts` reach the relocated models, and `comments-live.ts` reaches interaction selectors, until step 7. `src/lib/recovery.ts` reaches models and the recovery service until step 12; `scripts/recovery-sql.mjs` also reaches models until then. `scripts/promote.mjs:23`, `scripts/comments-store.mjs`, and `scripts/promote-filter.mjs` reach models until step 13. `scripts/unpromote.mjs` reaches the moved `sqlValue` directly until step 13 supplies its service interface. `src/components/Comments.astro:4` imports `commentHref` from the relocated model until step 15 replaces that import with a selector projection. No `lib/` forward is added for `commentHref`.

**Acceptance:** shipped migration statements and order are unchanged; migration replay/concurrency and bootstrap tests pass. No live interaction-store implementation remains under `activitypub/`. Both runtime entrances use the relocated store through the middle. Run the matrix. The landed changeset references and closes issue #73; the proposal, ADR, and earlier steps leave it open.

### 6. Split framework content access from selector logic

Add `src/astro.binding.ts`, the `virtual:astro` declaration, and the site alias. Add `worker/astro.stub.ts` plus consumer build/type resolution for the same alias. The stub exposes matching exports and throws when a read/render is called, not at import time.

Extract collection reads/render calls from posts, notes, and promoted comments into `src/persistence/content/`. The old `lib` entry modules keep their public exports during this split, now delegating to persistence. Their sorting, flattening, visibility, URL, date, and content-render result contracts remain unchanged. Resolve O13 before changing shared content-schema registration.

**Temporary imports:** `src/lib/posts.ts`, `src/lib/notes.ts`, and the promoted-comment read module reach `src/persistence/content/`. Step 7 moves these callers into selectors and closes those imports from `lib/`.

**Acceptance:** a consumer-aliased graph imports successfully; a content read or render in that graph fails explicitly. Astro renders content through the real binding. Bundle fixtures resolve the alias rather than relying on Astro accidentally being available. No additional collection cache or changed read count. Run the matrix.

### 7. Share filename parsing, then relocate selector modules

Keep 7a and 7b as separate green changesets: a function split, then relocation.

**7a — Split filename grammar.** Put `parsePostFilename` in `src/models/content/post-filename.ts`. It supplies filename matches and calendar-validity facts. Preserve each caller's acceptance and fallback rules. **Today's copies:** `src/lib/posts.ts:47,65`, `scripts/newpost.mjs:101-112`, and `scripts/frontmatter.mjs:46-48`. Redirect these callers to the parser. Scripts reach it through a forward in `src/services/authoring/posts.ts`; step 14 builds the authoring use cases around that interface. Apply the Plain-Node rule under Conventions to this forward. Selectors use the model directly after 7b. The temporary `src/lib/posts.ts` → model import closes in 7b.

**7a acceptance:** cover year-prefix grouping, year/month/day forms, invalid calendar dates, and publication-date fallbacks. Preserve the commands' different validation and tag-inference behavior. Run the matrix and the Conventions check.

**7b — Relocate selectors.**

Move posts and notes to `src/selectors/{posts,notes}.ts`. Move comment visibility, runs/display preparation, promoted reads, and live reads under `src/selectors/interactions/`. Keep public names available from the documented selector interfaces. Views import result types through the middle, rather than reaching into models or the binding.

Redirect pages, components, RSS, and ActivityPub callers. Do not change selector signatures, fields, meanings, ordering, pagination, rendered-content results, or exceptions. Internal helpers may stay separate files to keep this a relocation.

**7b acceptance:** existing comment visibility and output tests pass. Compare generated public URLs, ordering, note anchors, RSS, and representative content output against the baseline. Verify views have no `astro:content` imports, including type-only imports. Run the matrix.

### 8. Split auth into edges, services, record persistence, and gateways

Keep the session entry at `src/services/session.ts` during this split; step 9 relocates it to `src/services/auth/session.ts`. Other extracted auth services use `src/services/auth/`. Extract cookie/request decoding into `src/params/auth.ts` and cookie output into `src/schemas/auth-cookies.ts`. Keep expiry/role decisions and cleanup orchestration in services. Entrances and the session island parse the credential and pass it to the service; they do not store a resolved session in global middleware context.

Add the shared accessor `src/persistence/records/record.ts`: `recordAt<T>(location)` supplies get/put/remove. A per-kind module binds the registered location and adds only real behavior, such as TTL, caps, or defaults. It does not repeat the accessor. Add `src/models/records/<kind>.ts` only for a kind with a real value shape. Sessions use `src/persistence/records/sessions.ts` for location/TTL and `src/models/records/sessions.ts` for their shape. Failures and departures get model modules if their values warrant them; simple record kinds do not require model files. Steps 10 and 11 follow this pattern.

Split callback decoding and state/PKCE checks from the GitHub login use case. Put token exchange and user lookup in `src/gateways/github.ts`, with secret access through the platform. Response/redirect/error mapping stays in the route. Extract only domain-neutral encoding/random-byte helpers to `lib/`; auth decisions remain services. Inject the expiry decision's time; leave timestamp-only uses simple.

Until B11 removes the login page, extract its markup/styles/browser behavior to `src/components/auth/LoginPage.astro`. Put its prepared labels in `src/selectors/auth/login.ts`. The existing login page delegates and renders; these login-only modules are temporary and B11 removes them. This ordering preserves a failure display while O14 remains unanswered. B11 runs after steps 8–9 once O14 selects its replacement. Preserve output and auth policy during this split.

**Temporary imports:** old auth route files use the newly separated edges and middle-band entries. If `session-core.ts` retains forwarding exports to those modules, step 9 removes them with the old auth entrances. The session island still imports `src/services/session.ts`; step 9 changes that import with the service relocation.

**Acceptance:** preserve the C1 tests, including cleanup failure logging without credentials. Check state before exchange, missing verifier, exchange/user failures, redirect refusal, cookies, logout's POST/204 contract, and session revocation. Exercise the real login/island wiring. Static builds do not acquire auth/storage through middleware. Run the matrix.

### 9. Relocate auth entrances and the separated session service

Move `src/services/session.ts` to `src/services/auth/session.ts` and update all callers in this relocation changeset. All target auth services now live under `src/services/auth/`. Move the separated GitHub, callback, and logout handlers to `src/routes/auth/` and update integration entrypoint strings. Relocate the temporarily retained login page to `src/pages-extra/auth/`. It already delegates to the selector and feature component from step 8. Inject that page only in the full profile. No HTML page moves into `src/routes/`. Remove obsolete auth forwarding modules without changing their function bodies. B11 removes the temporary page and its empty `src/pages-extra/auth/` directory once O14 is answered.

**Acceptance:** the same login/callback/logout URLs and statuses resolve until B11 changes the login behavior separately. Auth boundary tests import the relocated handlers; full-profile rendering reaches `src/services/auth/session.ts` and static output omits the feature. Run the matrix.

### 10. Split ActivityPub composition, use cases, output, and reactions

Split `federation.ts` and `outbox.ts` by responsibility. The backend graph contains no Astro imports. The site and consumer entrances compose a shared set of backend registrations in their respective processes; only the site adds content-backed registrations.

| Responsibility | Target home |
| --- | --- |
| Fedify construction, signing-key import, object resolution, lookup/send mechanics | `src/gateways/activitypub/` |
| Thin runtime access used by entrances; follow/inbox/publish/delivery use cases | `src/services/activitypub/` |
| Actor data, outbox timeline, followers/following, interaction counts | `src/selectors/activitypub/` and `src/selectors/interactions/` |
| Incoming field and cursor decoding | `src/params/activitypub.ts`, `src/params/activitypub-paging.ts`; the latter also owns AP `PAGE_SIZE` and `FIRST` |
| `page(items, offset, size)` windowing | `src/lib/page.ts`; dispatchers supply the size and compose it with cursor parsing |
| HTTP representation mapping | `src/schemas/activitypub.ts` |
| Actor/content change announcements and departure diagnostics | `src/signals/activitypub/` |
| `actor-digest`, `note-digests`, `following`, `follow-ledger`, `departures` record access | Bind registered locations through step 8's `src/persistence/records/record.ts`; per-kind modules add only real behavior, with model files only for real value shapes |
| Inbound dispatcher/listener registration and HTTP negotiation | `src/routes/activitypub/` |

Use explicit composition to avoid cycles. Entrances install callbacks which delegate to services/selectors. Services reach the runtime through bottom-band adapters, never by importing registration modules. Bottom modules receive callbacks/data where composition requires them; they do not import services. Shared initialization must not import the site's content-backed outbox. Keep one instance per process and avoid duplicate registration.

Put following-ledger add/remove in `updateFollowing` in `src/services/activitypub/following.ts`, backed by `src/persistence/records/following.ts`. Accept, unfollow reconciliation, actor deletion, and Reject handling all call this operation. Preserve duplicate handling, list order, and late-Accept checks. **Today's removal copies:** `src/integrations/activitypub/federation.ts:251-252`, `:473-474`, and `:513-514`. Keep resolved follow intent in the separate registered `follow-ledger` record module; it is a different record kind.

Split `paging.ts` into cursor parsing under `src/params/activitypub-paging.ts` and neutral `page(items, offset, size)` windowing under `src/lib/page.ts`. Put AP's `PAGE_SIZE = 20` and `FIRST = () => "0"` in that params module. **Today's definitions:** `src/integrations/activitypub/paging.ts:11,14`. Dispatchers supply `PAGE_SIZE`, compose parsing/windowing, and encode the next cursor. Preserve invalid-cursor fallback and first-cursor behavior. No selector imports `src/params/`; the library has no AP page-size default.

Add neutral template filling and URL matching in `src/lib/path-template.ts`. Complete step 5's `src/models/activitypub/object-id.ts` with `OBJECT_PATH_TEMPLATE`, `objectUrl`, and `contentIdentifierOf`, using that codec. Callers supply host and user values from `src/config/`. Preserve the existing decoder's acceptance and the invariant that every already-published id still decodes; no content lookup enters this graph.

Extend `src/selectors/activitypub/objects.ts` to forward the model's scheme exports and the gateway's object constructors. Routes obtain `OBJECT_PATH_TEMPLATE` through this middle-band interface. Use it for Fedify registration. Astro integration wiring also obtains it through this interface and converts it to Astro's bracket syntax, preserving parameter mapping. Test that the injected pattern agrees with the model for post and note ids. Step 14's probe reaches the model through its authoring service. This pure forward is intentional under strict traversal and is recorded against O1, not an obsolete compatibility export.

Keep object constructors in `src/gateways/activitypub/objects.ts`. They use the model for AP ids and receive content URLs as values from post/note selectors. The selectors retain `/posts/{slug}/` and `/notes/{year}/#{id}`; the gateway owns neither contract. Outbound gateways use the same constructors with service-supplied values; services/signals never import an HTTP schema module. Apply the Plain-Node rule under Conventions to the shared scheme/constructor graph used by script-facing entries. Content loading stays in separate selectors.

Before replacing Fedify's `ctx.getObjectUri` call, add a test using the actual Fedify context and dispatcher registration. Assert exact equality with `objectUrl` for a post and a note. Keep regression cases for decoding already-published ids. A mismatch must be resolved while preserving those ids before the call is replaced.

Cover `delivery.ts` with the delivery service and outbound gateway; cover `inbox-handlers.ts` with inbox services and edge decoding. Move `routes/federated.ts`'s negotiation into `src/routes/activitypub/federated.ts`. Step 17 audits these source files explicitly.

Keep actor/outbox write orchestration in explicit service calls separate from selector reads. Preserve the existing GET triggers, await order, digest-write order, and error propagation during this split. O15 decides which service calls GET entrances may trigger; any trigger change gets a separate behavior changeset. B13 separately takes schema initialization out of the request path. Keep the actor/key, inbox, follower/following, outbox, featured, object, replies, permanent-failure, and NodeInfo registrations. Preserve counters, first cursors, and unpaged follower fan-out.

**Temporary imports:** `worker/consumer.ts` still reaches runtime and pruning through the old `federation.ts` forwarding interface until step 11. The old integration entrypoint may forward to the relocated federated handler until step 16 updates its wiring. New services, selectors, signals, and bottom modules do not import these forwards or registration modules.

**Acceptance:** federation/inbox tests cover signer/attribution checks, embedded Undo, late Accept, personal-inbox pruning, and delivery marking. Exercise the actual registration graph for site and consumer. Assert unchanged paging, totals, negotiation, activity/object identifiers, and first-run suppression. No consumer content read. New backend modules introduce no reverse layer imports; the named temporary forwards remain until their closing steps. Run the matrix.

### 11. Split consumer application work from queue transport

Keep queue decoding, `processMessage`, readiness handling, ack/retry, attempt ceiling, and backoff in `worker/consumer.ts`. Add service entries for queued delivery and recording exhausted delivery failures. Bind the registered failure location through step 8's `recordAt` accessor in `src/persistence/records/delivery-failures.ts`; retain only failure-specific behavior there. Add `src/models/records/delivery-failures.ts` only if the extracted value has a real shape to define. Reach runtime work and follower pruning through their services; remove the worker's old federation import.

**Acceptance:** transport tests cover success, retryable failure, exhausted failure, never-ready retry, and never-ready exhaustion. Verify failure-record/pruning/ack order and exact retry delays. Never-ready exhaustion still avoids follower pruning. The worker's only direct platform use is queue transport; update data-check accordingly. Run the matrix.

### 12. Split recovery rules from operational adapters

Move recovery selection, format validation, import/export orchestration, nonempty-destination refusal, and cross-row checks into `src/services/recovery/`. Move `scripts/recovery-records.mjs`'s `recordLayerDescriptors` and logical record recovery planning into `src/services/recovery/records.ts`. Put row schemas in models and SQL descriptor/statement construction in `src/persistence/interactions/recovery-sql.ts`. Keep format version 4 and all current recovery selections.

Move `quoteSqlIdentifier` into `src/persistence/interactions/sql-text.ts`, beside step 5's `sqlValue`. In this step, redirect `scripts/data-config.mjs` (`make data`) to `src/services/recovery/sql-text.ts`, which exposes quoting with the existing error mapping. Redirect `scripts/recovery-sql.mjs` to `src/services/recovery/sql.ts` for SQL plans. That service delegates statement construction to `src/persistence/interactions/recovery-sql.ts`, which uses the same bottom-band quoting module. Neither script imports persistence.

Keep `RecoveryError` in `src/services/recovery/errors.ts`, independent of recovery orchestration. The services map bottom-band validation failures to the existing code and message. The generator's quote-only entry imports neither generated register output nor the recovery orchestration modules. Recovery modules do not import the generator. This leaves `make data` free of a recovery-to-generator cycle; `src/config/` still depends only on the neutral key grammar.

Scripts retain mode parsing, stdin/stdout, filesystem staging, connection mechanics, subprocesses, and host execution. Apply O8's agreed adapter boundary. The service decides the restore unit and order; concrete adapters implement atomic execution. Node retains its file/transaction safeguards; D1 retains its execution and failure contract. Apply the Plain-Node rule under Conventions; pass concrete execution facilities explicitly. Remove the old recovery module and script-to-model imports recorded in steps 4–5.

**Acceptance:** recovery selection/version, row-reference, nonempty-store, dry-run, rollback, round-trip, and interrupted-cleanup tests pass. Preserve secret exclusions, session exclusions, document shape, file permissions, and error codes. Update every recovery fixture's copy/import list. Run the matrix.

### 13. Split comment operations from command procedures

Extract promotion validation, typed-content conversion, filter mechanics, state computation, archive selection, tombstone rewriting, and unpromotion refusal/planning into interaction services/selectors. Put `scripts/promote-text.mjs`'s typed-content conversion in `src/services/interactions/promote-text.ts`. Preserve its current link predicate: trim the value, require `URL.canParse`, then accept only `http:` or `https:`. **Today's predicate:** `scripts/promote-text.mjs:21`. It differs from the model's `httpUrl` for inputs such as `"http:x"` and `"https:/x"`. Keep both contracts during extraction; B12 owns any later unification. Keep optional actor-profile lookup behind a gateway.

Move `scripts/comments-rows.mjs`'s column and row-access helpers to `src/persistence/interactions/comment-rows.ts`. Move operation SQL into interaction persistence. Scripts reach both through middle-band operation interfaces. This closes the direct model and `sqlValue` imports recorded in step 5.

Scripts retain file/ref readers and writers, command summaries, prompts, Git/PR procedures, and apply/dry-run handling. They pass snapshots and execute validated plans. Keep the main/proposal distinction and the shared proposal-ref reader. Apply O6's policy interface without changing the selected filter or its behavior.

Apply the Plain-Node rule under Conventions. Keep snapshot/plan operations separate from runtime entry points that load aliased stores.

**Acceptance:** promotion, tombstone, unpromotion, comments CLI, proposal-ref, and workflow mutation tests pass. Preserve conversion and later model validation separately for ordinary links, `"http:x"`, and `"https:/x"`. Preview writes nothing; regenerated proposals preserve earlier proposed work; only main proves write-back. Keep add-only promotion, withdrawal visibility, escaped typed runs, and the unpromote retry order. Run the matrix.

### 14. Split authoring rules from root commands

Extract note identifier preparation, UTC archive selection, conversion decisions, post period/default preparation, missing-frontmatter rules, tag validation, pinning, and follow-intent changes into services. Use `src/services/authoring/posts.ts` for post preparation and frontmatter decisions. It calls `parsePostFilename` from `src/models/content/post-filename.ts`, through the interface introduced in step 7a. Remove the remaining command-owned classification and tag-inference decisions without changing their acceptance modes.

Use one registered-tag authoring service, `src/services/authoring/tags.ts`, for both reading the registry and preparing additions. Post creation, tag listing, and tag creation call it. Scripts supply the source at `tags.file` and apply its edit plan. Keep the interactive and dedicated-command validation modes distinct until B6 lands. Step 3 already replaces hardcoded configuration paths with registered locations.

Put the note publication probe in `src/services/authoring/notes.ts`, calling a gateway. The service obtains `objectUrl` from `src/models/activitypub/object-id.ts` and passes the resulting URL to the probe gateway. It supplies host/user values from configuration; scripts use `apConfig.file` when supplying configuration source. This closes the probe's separate object-id construction from C24. Keep neutral reusable parsing in `lib/` only when it has no content/protocol/storage knowledge.

Keep filesystem/process interaction and Chinese command output in scripts. Use explicit file extensions for modules imported by Node operations. Expose separate existing validation modes where commands currently disagree; unifying their acceptance is B6. Preserve the explicit-path conversion behavior pending B4.

Apply the Plain-Node rule under Conventions. Supply file snapshots and execution facilities as inputs.

**Acceptance:** exercise command dry runs, invalid dates, duplicate note identifiers, archive-year boundaries, existing metadata, pin/follow edits, and refusal output with supplied snapshots/fakes. Compare resulting content/configuration documents to baseline behavior. Verify one filename parser, one registered-tag service, and the model's AP object-id scheme serve their callers. Run the matrix and the Conventions check.

### 15. Split page presentation from route and selector work

Extract markup/styles into feature components: home/archive, posts, notes, tags, the novel, and the not-found view. Use directories such as `src/components/posts/` and `src/components/notes/`; even a single-page component belongs there. Keep all route paths and `getStaticPaths` responsibilities at the entrance.

Add selector projections for home year groups, post/tag/page links, note-year/latest views, RSS items, safe comment links/dates, and site shell display data. Name `tagHref` in `src/selectors/posts.ts` for the three pages that build tag URLs. Name `noteYearHref` and `notesForYear` in `src/selectors/notes.ts` for year links and filtering. Pages and the notes island reuse these helpers. Keep existing selectors unchanged and let the new projections wrap them. Pages pass the result to views. Views can still call the middle directly when useful; only pure views require supplied props.

Keep the existing reusable views at `src/components/Comments.astro`, `src/components/NoteList.astro`, `src/components/PostList.astro`, and `src/components/Progress.astro`. Comments receive safe links/dates through the new selector projection; remove its direct `commentHref` model import from step 5. NoteList and PostList use the middle-band display interfaces. Progress remains a presentation component. Page-only extracted components live under the feature directories named above.

Keep server islands, static/full wrappers, alias declarations, and note-slot placement in components. A notes island delegates year selection and live comment preparation to the middle. `Base.astro` may retain `virtual:session-bar`. Do not create route-owned island/fragments modules or introduce global session resolution.

**Acceptance:** check both profiles' rendered contracts: URLs, pagination, note anchors, comment escaping, withdrawal behavior, logout races, and island loading markers. Full-profile prerendered HTML contains neither personal identity nor live comment text; deferred responses retain `private, no-store`. Verify one comments island per post/year page. Compare representative rendered pages for unintended markup/style changes. Run the matrix.

### 16. Relocate framework wiring, if O2 chooses it

Move only the Astro integration factories and dynamic-route manifest hook to the agreed build-wiring home. `astro.config.mjs` is the recommendation. Backend code has already left the integration trees. Update injected entrypoint strings and build imports; preserve conditional installation and the framework-resolved route manifest.

**Acceptance:** static/full route inventories match the preceding changeset. Feature-off builds omit the backend graphs. Dynamic manifests include Astro-owned island routes without inventing source routes. Run the matrix. If O2 retains dedicated wiring modules, this changeset instead removes obsolete backend forwarding modules and records that chosen home.

### 17. Audit final boundaries and align documentation

Search exact old path spellings across imports, dynamic imports, bundle-entry strings, copied fixtures, Makefile, shell scripts, workflows, generated declarations, and checkers. Remove obsolete compatibility exports. Update current architecture/configuration/interaction/recovery documentation and the selector export inventory. Preserve historical ADR context; a changed decision gets the repository's decision-record process, not an unnoticed rewrite.

Audit `.astro` server imports and component-alias targets as well as TypeScript. Check that `lib/` is neutral, selectors never call services or write, operations contain no application-rule copies, and services never import entrance schemas/routes. Check every temporary import against its named closing step. Retain the intentional `src/selectors/activitypub/objects.ts` forward recorded under O1; do not flag it as obsolete merely because it forwards. Do not declare complete read purity until B13 lands; record GET-trigger policy separately under O15. Record the repository's retention/fingerprint exceptions and any decision on stronger recovery guarantees in the implementation record.

Audit these source files explicitly; responsibility rows alone do not account for their remaining exports:

| Source inventory — today's paths | Owning step and destination |
| --- | --- |
| `src/integrations/activitypub/delivery.ts` | Step 10: delivery service and outbound gateway |
| `src/integrations/activitypub/inbox-handlers.ts` | Step 10: inbox services and edge decoding |
| `src/integrations/activitypub/routes/federated.ts` | Step 10: `src/routes/activitypub/federated.ts` |
| `scripts/comments-rows.mjs` | Step 13: `src/persistence/interactions/comment-rows.ts`, reached by scripts through services |
| `scripts/promote-text.mjs` | Step 13: `src/services/interactions/promote-text.ts`; preserve its link predicate until B12 |
| `scripts/recovery-records.mjs`, especially `recordLayerDescriptors` | Step 12: `src/services/recovery/records.ts`; command procedures remain in the root script |
| `scripts/ap-check.mjs` | Retain at the root as a live conformance probe and deliberately independent oracle. Its expectations do not reuse the application's constructors or acceptance rules. It is not an offline build gate. |

**Acceptance:** every remaining old-path hit is classified as historical evidence or corrected. Repeat the matrix after the last executable edit. An import audit is a self-check unless O7 installs it in CI as a fast, offline gate. The audit reports dynamic imports or generated paths it cannot resolve instead of claiming coverage for them.

### Behavior changes to keep separate

Each row describes a separate behavior concern, with the disposition and acceptance checks it needs. Approved changes get their own changesets after their prerequisites. The list retains plan v2's concerns under the settled design. The source column is explicitly **today's code**.

| Ref | Separate change and today's evidence | Recommendation and acceptance for that changeset |
| --- | --- | --- |
| B1 | Signal/request failure semantics. Actor announcements and departure diagnostics are awaited (`src/integrations/activitypub/federation.ts:319`, `:139`); outbox reactions are awaited (`src/integrations/activitypub/outbox.ts:262`). | Preserve awaits during the split. After O4, fault-inject each reaction and assert the chosen HTTP result, queue acknowledgement/retry, durable state, and diagnostics. “Move to signals” alone changes none of these. |
| B2 | Delivery beyond `AP.published`. The dispatcher slices before building candidates (`src/integrations/activitypub/outbox.ts:236`, `:251`). ADR 0001 and the config comment describe a collection-only window (`docs/decisions/0001-the-outbox-window-is-about-the-collection-only.md:1`; `src/integrations/activitypub/config.ts:27`). | O5 should align delivery with the collection-only policy in its own change. Test a nonzero window, pending content outside it, collection/NodeInfo limits, and first-run suppression. |
| B3 | Atomic comment/reaction identity writes. They are separate statements (`src/integrations/activitypub/store/identity-write.ts:29`). Followers are atomic (`src/integrations/activitypub/store/follower-rows.ts:41`). | Preserve the distinction. Any future atomicity change needs failure/concurrency tests and its own reason. Followers' dedicated atomic upsert is settled and is not reopened. |
| B4 | Post-to-note conversion through an explicit path. Published-post treatment depends on `file === asPost` (`scripts/note.mjs:68`). | After extraction, fix separately with slug/relative/absolute-path cases that demonstrate the same published-content refusal. Preserve dry-run and archive safeguards. |
| B5 | Unifying live visibility with archive rewriting. The live read uses the supplied withdrawal time (`src/lib/interactions/comment-view.ts:22`); rewriting preserves an existing tombstone time (`scripts/tombstone.mjs:60`). Object-shape handling also differs. | Keep the implementations' contracts during extraction. Unify only after choosing timestamp precedence and retained fields; test fixed-point removal and pre-existing tombstones. |
| B6 | Unifying tag validation. Interactive creation accepts `^\w+$` (`scripts/newpost.mjs:163`); the dedicated command requires a lowercase leading letter (`scripts/newtag.mjs:18`). | Preserve explicit modes initially. A later input-policy change tests digits, uppercase letters, underscores, and existing registry entries. |
| B7 | Time and formatting cleanup. Post creation combines local fields with fixed `+08:00` (`scripts/newpost.mjs:134`); comment dates use slicing (`src/components/Comments.astro:15`). | Inject time at rule decisions without changing output. Any timezone/format correction gets boundary-date tests across host timezones and a reviewed output change. Timestamp stamping alone does not require injection. |
| B8 | Session-resolution coverage. Today's callers include the login page (`src/integrations/auth/routes/login.astro:8`) and session island (C2). | Keep resolution at renderers that need it; B11 removes the login-page caller. Wider request coverage is outside this plan; global session middleware is excluded by the settled design. Acceptance for the auth split verifies unrelated routes gain no session-store read. |
| B9 | Read-time schema initialization. `src/integrations/activitypub/store/database.ts:20` migrates before returning a handle to reads. | Superseded by B13 (O10): schema initialization leaves the request path rather than moving within it. |
| B10 | Stronger announcement provenance/recovery. Digest comparisons and write-before-send checkpoints appear at `src/integrations/activitypub/federation.ts:79` and `src/integrations/activitypub/outbox.ts:200`, under ADR 0003's policy. | Preserve the existing policy. If O12 requests stronger evidence, use a separate data/decision change with migration/recovery, loss/rebuild, duplicate-send, and retention tests. Do not relabel a fingerprint as raw or retain deleted text implicitly. |
| B11 | Remove the login page. The auth integration injects `/login` (`src/integrations/auth/index.ts:11`), and a failed GitHub callback redirects there (`src/integrations/auth/routes/callback-handler.ts:70`). | Removal is settled. It follows steps 8–9 because O14 must choose a replacement failure display first; those steps preserve a working display meanwhile. Once O14 is answered, remove the page, its injection, the temporary login-only component/selector, and the empty `src/pages-extra/auth/` directory. Change the failed callback's destination in this separate behavior changeset. Verify failures show the chosen reason without `/login`, successful login and safe returns still work, and neither profile exposes a login page. |
| B12 | Unifying typed-content link acceptance with the model's `httpUrl`. The converter uses `URL.canParse` plus HTTP(S) at `scripts/promote-text.mjs:21`; the model defines `httpUrl` at `src/lib/interactions/records.ts:5`. They differ for `"http:x"` and `"https:/x"`. | Preserve both predicates in step 13. Any unification requires a separate input-policy decision and behavior changeset. Test ordinary, malformed, and those differing URL forms against conversion output and subsequent model validation; choose acceptance and normalization explicitly. |
| B13 | Migration is its own operation, separate from serving requests (O10): no request triggers a migration. Today `store()` runs `migrate(db)` once per isolate on first access (`src/integrations/activitypub/store/database.ts:15-20`). | Expose the migration as an operation the application provides, run by a CI step per host during operations, and take it out of the request path; a request may check that the schema is current, and what it does when it is not is defined here. Acceptance: a fresh database is migrated by that operation alone, and serving a request never issues schema statements. |

Also preserve first-run delivery suppression, process-local `sentUnmarked`, digest-write ordering, fallback publication timestamps, and the consumer retry curve. Collection caching, batched content reads, new delivery guarantees, and new cleanup coverage need their own changesets. A behavior changeset runs its focused checks and the same acceptance matrix.

## Open items

The layering decisions stand. These questions concern implementation choices, behavior contracts, or evidence still needed. Recommendations are proposals, not additional owner decisions.

1. **O1 — Does the blog permit a pure pass-through layer skip?** Owner. Recommend retaining strict traversal for this migration. It gives entrances/views a stable middle-band interface and avoids classifying exceptions while moving code. `src/selectors/activitypub/objects.ts` is an intentional pure forward for the AP scheme and constructors under that rule. Step 17 retains it unless an explicit O1 decision authorizes bypassing it. Any later exception needs an exact allowed edge and coverage; the general skill's allowance does not enable it automatically. **Owner (2026-10-21):** no layer skipping in this migration.

2. **O2 — Where do Astro integration objects and dynamic-route hooks live?** Owner, then implementer. Recommend `astro.config.mjs` while the wiring stays small. A dedicated build-wiring module is also viable. Choose before step 16; either home contains framework wiring only. Check before step 16: the integration reaches the object-path template at configuration time, so the module it imports must load without `virtual:*` and without pulling Fedify's constructor graph; if the selector forward cannot, import the template from a narrower forward. **Owner (2026-10-21):** as recommended.

3. **O3 — Is the bound-parameter budget a persistence constant or a platform property?** Owner, then implementer. Recommend a database capability supplied by the platform if host limits must differ; otherwise retain one conservative, named persistence budget. Preserve today's 100-minus-reserved batching during relocation. Any changed budget needs boundary tests for reserved parameters and both adapters. **Owner (2026-10-21):** as recommended.

4. **O4 — May a reaction failure fail the surrounding request or queue task after the underlying change succeeded?** Owner. Recommend treating nonessential reactions as independently reported failures, with retries only where their contract requires them. Preserve current awaits until that contract is approved. Specify actor updates, content updates, and departure diagnostics separately; a shared folder does not give them one retry policy. **Owner (2026-10-21):** each reaction reports its own failure; whether one may fail the request is decided case by case, not in this migration.

5. **O5 — Should `AP.published` stop constraining delivery candidates?** Owner. Recommend the collection-only meaning already written in ADR 0001. Implement B2 separately after tests expose the nonzero-window difference. This does not reopen the layer placement. **Owner (2026-10-21):** `AP.published` only bounds what the collection lists; `0` lists everything. B2 is the separate change that brings delivery in line.

6. **O6 — How should the owner edit the promotion filter?** Owner. Recommend named filter choices and arguments in `src/config/promotion.ts`, composed by services. Preserve the selected `byFollowing` behavior. If arbitrary executable composition is required, expose service-owned combinators through a root operation; keep application rules out of the editable script. **Owner (2026-10-21):** undecided.

7. **O7 — Which Node, consumer, and boundary checks become CI gates?** Owner. Recommend an offline pre-deploy consumer build, full/static Node builds, and a bounded import check once their commands are fast and demonstrably offline. Until installed in CI, the acceptance matrix is self-check evidence. Keep live conformance checks separate from offline gates and do not infer deployment success from a build. **Owner (2026-10-21):** a check becomes a CI gate only when it needs no network and its pass/fail is measurable and unambiguous.

8. **O8 — How strict is the script entrance rule for recovery adapters?** Owner. Recommend service entry points for migration/recovery policy and plans, with host execution under `scripts/platform/<target>/`. Decide whether those concrete adapters may import platform primitives directly as composition wiring. Whichever answer is chosen, it permits no second implementation of validation, keys, selection, or refusal rules. **Owner (2026-10-21):** each host has its own recovery modules, in its platform, that validate and restore for that host; everything else goes through `src/services/` by default, unless a forward is stated explicitly. This replaces the recommendation above: step 12 places host-neutral recovery rules in services and host-specific validation and restore in each host's platform module.

9. **O9 — Where would an independent vendored embed with its own fetcher and views live?** Owner when one is introduced. Recommend creating `src/plugins/<name>/` only for a self-contained library with a public interface and no application-data dependencies. Otherwise use feature components plus the middle band. **Today's inventory:** `rg --files src` found no `src/plugins/`; this plan adds no empty plugin directory. **Owner (2026-10-21):** as recommended.

10. **O10 — Where does database readiness run so selectors never initialize schema?** Implementer, with owner confirmation if timing/failure behavior changes. Recommend an explicit service-owned initialization step in runtime composition, including the consumer and recovery paths. Preserve readiness sharing and retry after failure. B9 implements this read-purity change separately. O15 decides which other service writes a GET entrance may trigger; step 10 preserves AP publication/reconciliation triggers during extraction. **Owner (2026-10-21):** migration and serving requests are two separate things. The application may provide and run the migration, but as its own operation (executed by CI during operations), never inside the path that serves a request. This replaces the recommendation above. B13 implements it.

11. **O11 — Does the owner confirm the retained external-data costs and failure behavior in the data story?** Owner. Recommend keeping the existing GitHub, ActivityPub, host, and identity-infrastructure dependencies, adding none for this migration. Keep actor display names optional; require trusted service checks for identity-sensitive decisions. Record confirmation before implementation relies on a new or changed external dependency. **Owner (2026-10-21):** confirmed for this migration.

12. **O12 — Does future announcement recovery need stronger evidence than the current fingerprints?** Owner. Recommend preserving ADR 0003 and the register's recovery policy during this migration. If reconstructible announcement history or stronger retry guarantees become requirements, propose retained source/version and outcome evidence in a separate decision. Existing deletion, session-expiry, and recovery-exclusion rules remain in force. Current digest records do not become lossless caches because their files move. **Owner (2026-10-21):** as recommended.

13. **O13 — How does Astro's fixed content configuration reuse shared schemas under the import rule?** Implementer and owner if a wiring exception is needed. Recommend one shared model schema and explicit framework registration wiring. First demonstrate the import graph for Astro, plain Node operations, and the consumer. If `src/content.config.ts` must import a model to register it, record that narrow composition exception explicitly before steps 5–6. Do not copy validation or call an upward import downward. **Owner (2026-10-21):** as recommended.

14. **O14 — Where is a failed login's reason shown once `/login` is gone?** Owner. Recommend the full-profile session panel on the safe return page. The callback supplies an allow-listed error code in the return URL; the panel's browser code maps it to a fixed message. This needs no new page or session endpoint. Decide before B11 removes the login page. **Owner (2026-10-21):** decided when the login removal (B11) is taken up.

15. **O15 — Which separate service calls may a GET entrance trigger?** Owner. Recommend keeping selector reads free of migration, cleanup, publication, and delivery work. Limit cleanup during a GET to removing logically unusable state, such as an expired session. Keep a logical state transition as an explicit write use case. Preserve the existing AP publication/reconciliation calls as explicit service orchestration unless the owner chooses new triggers. This question concerns HTTP-trigger policy; it does not relax the settled rule that a read path does not write. Step 10 preserves behavior while exposing those service calls. B13 separately takes schema initialization out of the request path; any changed GET trigger needs its own behavior changeset. **Owner (2026-10-21):** left to the features that need it; this migration preserves today's GET-triggered work unchanged.

**Review status for this local draft:** round 1 — Sonnet correctness FIX-FIRST, structure (Claude) RESTRUCTURE non-blocking, Opus final FIX-FIRST; round 2 — Sonnet correctness FIX-FIRST, structure RESTRUCTURE non-blocking, Opus final FIX-FIRST; scoped verification of the round 2 fixes (Sonnet): all hold. The coordinator's edits recording the owner's answers were checked by a scoped Sonnet verification and corrected. **Owner approval of the Decision: 2026-10-21**, with O6 and O14 left to the implementation issue and the understanding that the record is adjusted where implementation shows it wrong.

**Security trigger record:** security review not run: no security trigger matched. Scope identity is this local Markdown draft, `docs/proposals/relayering.md`; no code/configuration change belongs to this revision. Each trigger row is no-match: URL/HTML sinks, identity/request checks, remote-input/storage operations, outbound requests/redirects, browser response policy, and privileged CI. The text discusses those operations but changes none. This records only the dispatch check, not a security verdict on the proposed implementation. The future code changes require their own trigger review.
