# 0018. `src/` is layered by role, and views may call the middle band

Status: accepted
Date: 2026-10-21
Revised: 2026-10-21

## Context

The site's central constraint is that the whole design layer can be thrown
away and rewritten without changing the data. The data must also survive a
change of framework or host. Code placement decides who reaches a store. It
must not change which store owns a fact.

Astro 7 serves every server island through one route it owns. That was
verified against the installed version, and it depends on that version.

The approved proposal is
[`docs/proposals/relayering.md`](../proposals/relayering.md).

## Decision

**`src/` is divided into bands by role, and imports point downward one band
at a time.** Entrances, views and framework declarations sit side by side
above the middle band.

- Entrances are pages, handlers, the queue consumer and the root scripts. Input
  parameters and response schemas are their edges.
- Views are components, layouts and styles.
- The middle band is services (writes, decisions, use cases), signals
  (reactions to a change in data) and selectors (reads shaped for the caller).
  Services may call selectors. Selectors never call services.
- The bottom band is persistence, models, migrations and gateways. Models own
  tables, row schemas and keys. Decisions across rows belong above them.
- Framework declarations tell Astro what the application contains: routes,
  integrations and collections. `astro.config.mjs` is one.
  `src/content.config.ts` is another, at the path Astro fixes. A declaration is
  neither a view nor the boundary. It sits above the middle band and may import
  selectors.
- The boundary is the platform and the framework binding. Content persistence
  reads the git database through the binding, `src/astro.binding.ts`
  (`virtual:astro`).
- Configuration and `lib/` are available everywhere. `lib/` is abstract,
  neutral logic and imports none of the application bands.
- The content files are the git database. Access to them follows the bands:
  content persistence reads them, and callers above reach that through the
  middle band.

No layer is skipped in this re-layering. A thin middle-band interface is still
the public interface, and a pure forward through it is intentional. The queue
consumer keeps its one exception: it takes queue transport from the platform,
and every state change it makes goes through services.

**A view may receive data as props or call the middle band itself.** That
includes writes. A write that needs uniform authentication, CSRF handling, a
transaction or logging enters through an entrance. The entrance runs the
authentication and CSRF checks; the service owns the business decision and
the transaction. Selectors prepare what a view prints. Views may import
framework rendering modules such as `astro:assets` and `astro:transitions`.
They never import `astro:content`, not even for types.

**A page and a server island act as routers: they parse, delegate and
render.** A server island is a view under `src/components/`. Astro's own route
serves it, so the tree has no island route files. An island is written like a
React Server Component. It reads request-time data through the middle band
and renders views. It still runs as its own deferred request. So it does its
own checks, sets its own cache headers, renders once and does not refresh.

**A request is a public endpoint, and props are internal.** A request is
opened only for data that exists only at request time. A component does not
get a route of its own. The renderer that shows who is signed in reads the
session through a service and passes it on as props. The session has no
endpoint and no middleware-populated `Astro.locals` slot.

**A page that exists only in the full profile lives in `src/pages-extra/`,**
one subdirectory per functional unit. Configuration registers those pages, and
only the full profile includes them. Astro does not route them by file.
`src/routes/` holds handlers only. The target design has no login page; its
removal is a separate change.

**Git content is a database alongside the interaction database.**
`getCollection` is its query interface. Content persistence reaches it through
`virtual:astro`. The queue consumer resolves that alias to a stub that refuses
content reads.

**A read path does not write.** If a read finds stale state, it reports it,
and a separate service call cleans it up. Migration is its own operation,
separate from serving requests. The application provides it. No request
triggers a migration. This replaces the provision of
[0007](0007-interactions-live-in-a-database-the-host-provides.md) that
migrations run once per isolate. A person runs a migration from an operations
script. An ordinary migration may instead run in a separate CI job,
independent of the deploy. The deploy still holds no database credentials, as
0007 requires. Only that migration job may hold the database permission
migrations need.

**Raw data is kept, except where repository policy says otherwise.** Raw data
is an authored input, a received value or an observed event. A derived value
may be recomputed from retained sources, and losing it must not lose
information. Where repository policy is silent, gates, keys, stop rules and
start conditions depend only on raw data, with its source named. The
repository's explicit retention, recovery and announcement policies take
precedence over this rule and are kept as they are: withdrawal clears a
comment's text; explicit unpromotion removes the archive entry and its row;
sessions expire or are revoked; departure diagnostics are capped; data the
register marks reset or ephemeral is left out of recovery; and the
fingerprints of [0003](0003-the-actor-announces-itself-when-it-is-built.md)
trigger announcements.

**Each signal reports its own failure.** The change it reacts to can succeed
without it. Whether a reaction's failure may fail the surrounding request is
decided case by case, outside this re-layering.

**ActivityPub and auth are backend features spread across the bands.** Their
application logic has no Astro dependency. Astro integration objects and
dynamic-route hooks are framework wiring only. They live in `astro.config.mjs`
while that wiring stays small. One model owns the site's ActivityPub object-id
scheme, using a neutral path-template codec in `lib/`. Every id already
published must still decode.

**Root scripts are operational entrances.** They call application rules and
never re-implement validation, ids, visibility or transitions. Prompts, Git
and pull-request steps, file and stream handling and deployment setup stay in
the scripts. For recovery, host-neutral rules live in services. Each host has
its own recovery module in its platform, which validates and restores for
that host. Everything else goes through services, unless a forward is stated
explicitly.

**A check becomes a CI gate only when it needs no network and its pass or fail
is measurable and unambiguous.**

Other placement rules:

- A collection's schema is model-level, as an ORM model's parse function is.
  Each content kind's model provides the schema its collection registers. A
  selector exposes it, and `src/content.config.ts` registers it. This holds for
  all four collections. A schema is never copied.
- The SQL bound-parameter budget is one conservative, named persistence
  constant. If host limits must differ, the platform supplies it as a database
  capability.
- Time is injected only where a rule decides by it. Recording a timestamp
  needs no clock abstraction.
- Followers keep their own atomic upsert of identity and follower.
- `src/plugins/<name>/` is created only for a self-contained library with a
  public interface and no dependency on application data. Anything else uses
  feature components and the middle band.

## Rejected

**Server islands as routes under `src/routes/islands/`.** Astro serves every
island through one route that the framework owns. The application has no
island route to put a file for. An island is written like a server component,
so it is a view.

**Views that only receive props and call no layer.** Layouts would need
route-owned fragments or slot detours to compose views they already import.
A server island does receive props from its page, and Astro carries them into
the deferred request. Props from a prerendered parent cannot carry data that
exists only at request time, such as who is signed in or live comments. The
island reads that data itself through the middle band.

**`lib/` as the design layer's exit to data.** `lib/` is abstract, neutral
logic, as it is in large projects. It imports none of the application bands.
A separate exit for the design layer should not exist at all: views reach
data through the middle band, as entrances do.

**A route per component.** A request is a public endpoint and props are
internal. A route per component turns internal composition into public
surface, and opens requests for data that does not exist only at request
time.

**Middleware that resolves the session into `Astro.locals`.** It would read
the session store for routes that never show who is signed in. Who is signed
in is read through services by what renders it.

**Full-profile pages under `src/routes/`.** `src/routes/` holds handlers.
Pages that only the full profile serves need their own group, which only that
profile injects and Astro does not route by file.

**A pass-through layer skip for this re-layering.** Strict traversal gives
entrances and views a stable middle-band interface. It also avoids
classifying exceptions while code is moving. A later exception needs a stated
edge, and the general allowance for skips does not enable it on its own.

**Migrating inside the request path, on first access before a read.** A read
would then issue schema statements, and a read path does not write. The
proposal first recommended an explicit service-owned initialization step in
runtime composition, including the consumer and recovery paths. The owner
replaced both: migration and serving requests are two separate things.

**Migration as a step of the deploy.** The deploy would then hold database
credentials, which 0007 rules out. A separate CI job may run an ordinary
migration instead, and only that job holds the permission.

**`src/content.config.ts` as part of the boundary.** It declares collections
to Astro, as `astro.config.mjs` declares routes and integrations. Placed in the
boundary, it sits below the models, so registering a model's schema would be an
upward import. It would need a named exception or a copy of the schema.

**Collection schemas written inside `src/content.config.ts`.** The schemas of
`posts`, `notes` and `komorebi` were written there: the tag list, the stamped
date, the shared fields and the note id rule. Only the comment archive schema
came from shared code. A schema is model-level, so it moves to its content
kind's model, and the declaration file keeps registration only.

## Consequences

- A redesign changes views. It may add a selector or wrap existing ones. It
  never changes an existing selector's output contract: fields, meanings,
  ordering and URLs.
- Today's GET-triggered work stays as it is until the features that need it
  decide. Whether a reaction's failure fails its request is decided for each
  reaction, case by case.
- Data stays where it is. The register moves to `src/config/`. SQL names,
  record keys and content paths do not change. The fingerprint policy of
  [0003](0003-the-actor-announces-itself-when-it-is-built.md) is preserved.
  The re-layering adds no new external dependency.
- Serving a request issues no schema statements. Migrations run from an
  operations script or from a separate CI job, and the deploy holds no
  database credentials.
- `src/content.config.ts` holds registration only. Changing a collection's
  schema changes its model.
- Island and page placement depends on Astro serving islands through its own
  route. A framework that does not would reopen it.
- A thin middle-band interface costs a forwarding module where a direct import
  would be shorter.
- Until a check meets the CI-gate condition, its green run is a self-check.
