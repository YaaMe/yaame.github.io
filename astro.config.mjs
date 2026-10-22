// @ts-check
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import { features, site } from "./src/config/site.config.ts";
import { OBJECT_PATH_TEMPLATE } from "./src/selectors/activitypub/object-id.ts";
import { GITHUB_CALLBACK_PATH } from "./src/schemas/auth-urls.ts";

const objectPath = OBJECT_PATH_TEMPLATE.replace("{identifier}", "[user]").replace("{slug}", "[slug]");

// Every Fedify dispatcher needs a matching route: static assets answer first,
// so an unmatched path returns 404 without reaching the Worker. A missing route
// is silent — the actor advertises the endpoint and the endpoint 404s.
const PATHS = [
  "/.well-known/webfinger",
  "/.well-known/nodeinfo",
  "/nodeinfo/[version]",
  "/users/[user]",
  "/users/[user]/inbox",
  "/users/[user]/featured",
  "/users/[user]/followers",
  "/users/[user]/following",
  "/users/[user]/outbox",
  objectPath,
  `${objectPath}/replies`,
  "/inbox",
];

const ROUTES = [
  { pattern: "/login", file: "./src/pages-extra/auth/login.astro" },
  { pattern: "/auth/github", file: "./src/routes/auth/github.ts" },
  { pattern: GITHUB_CALLBACK_PATH, file: "./src/routes/auth/callback.ts" },
  { pattern: "/auth/logout", file: "./src/routes/auth/logout.ts" },
];

// Astro's directory scan skips dot-prefixed names, so WebFinger needs injection.
/** @returns {import("astro").AstroIntegration} */
export function activitypub() {
  return {
    name: "activitypub",
    hooks: {
      "astro:config:setup": ({ injectRoute, logger }) => {
        const entrypoint = new URL("./src/routes/activitypub/federated.ts", import.meta.url).pathname;
        for (const pattern of PATHS) injectRoute({ pattern, entrypoint });
        logger.info(`${PATHS.length} federated routes injected`);
      },
    },
  };
}

/** @returns {import("astro").AstroIntegration} */
export function auth() {
  return {
    name: "auth",
    hooks: {
      "astro:config:setup": ({ injectRoute, logger }) => {
        for (const { pattern, file } of ROUTES) {
          injectRoute({
            pattern,
            entrypoint: new URL(file, import.meta.url).pathname,
          });
        }
        logger.info(`${ROUTES.length} auth routes injected`);
      },
    },
  };
}

// The link checker needs Astro's resolved routes, including its own island routes.
// Routes resolve before the build; the output directory is known only afterward.
// A missing manifest means every route is prerendered.
/** @returns {import("astro").AstroIntegration} */
export function dynamicRoutes() {
  /** @type {string[]} */
  let dynamic = [];
  return {
    name: "dynamic-routes",
    hooks: {
      "astro:routes:resolved": ({ routes }) => {
        dynamic = routes.filter((r) => !r.isPrerendered).map((r) => r.patternRegex.source);
      },
      "astro:build:done": ({ dir, logger }) => {
        if (dynamic.length === 0) return;
        writeFileSync(
          fileURLToPath(new URL("dynamic-routes.json", dir)),
          `${JSON.stringify(dynamic, null, 2)}\n`,
        );
        logger.info(`${dynamic.length} dynamic routes recorded`);
      },
    },
  };
}

// Chosen before the build, not branched on at runtime: the other target's
// implementation never enters the module graph, so its host-only imports never
// have to resolve. See the second architectural rule in CLAUDE.md.
const TARGET = process.env.DEPLOY_TARGET ?? "cloudflare";
const PROFILE = process.env.BUILD_PROFILE ?? "static";
// The static profile has no identity slot or server island. Choosing the
// component before the build keeps the full profile's auth import out of its
// module graph, as with the host boundary above.
const SESSION_BAR = PROFILE === "full"
  ? "/src/components/session/full.astro"
  : "/src/components/session/static.astro";
const COMMENTS_SECTION = PROFILE === "full"
  ? "/src/components/comments/full.astro"
  : "/src/components/comments/static.astro";
const NOTE_COMMENTS = PROFILE === "full"
  ? "/src/components/comments/notes-full.astro"
  : "/src/components/comments/notes-static.astro";

export default defineConfig({
  site: site.url,
  // Links are still emitted with a trailing slash — that is the external
  // contract, and `build.format: "directory"` is what keeps it. This setting
  // only decides whether the slashless form is a 404, and it must not be:
  // an ActivityPub actor id carries no trailing slash, and WebFinger's path is
  // fixed by the protocol at /.well-known/webfinger. Under "always" both
  // answer 404.
  trailingSlash: "ignore",
  build: { format: "directory" },

  adapter: TARGET === "node" ? node({ mode: "standalone" }) : cloudflare(),

  // Absent from the array when the feature is off, so nothing it pulls in —
  // Fedify included — is ever reached by the bundler.
  integrations: [
    features.activitypub && activitypub(),
    features.auth && auth(),
    // Always on: it records every route that is not prerendered, whatever
    // added it, and writes nothing when there is none.
    dynamicRoutes(),
  ].filter(Boolean),

  vite: {
    // One value, one source. Without this the page-side copy of site.config
    // would read an undefined process.env and silently fall back.
    define: { __BUILD_PROFILE__: JSON.stringify(PROFILE) },

    // Keep light-dark() intact. Below this target the CSS pipeline rewrites it
    // into a --lightningcss-light/--lightningcss-dark pair driven only by
    // `@media (prefers-color-scheme)` — which follows the OS and ignores the
    // `color-scheme` property, so the theme button would set a value nothing
    // reads. The whole dark theme is one light-dark() per token. These four are
    // the first versions that support the function.
    build: { cssTarget: ["chrome123", "safari17.5", "firefox120", "edge123"] },
    resolve: {
      alias: {
        "virtual:astro": "/src/astro.binding.ts",
        "virtual:platform": `/src/platform/${TARGET}`,
        "virtual:session-bar": SESSION_BAR,
        "virtual:comments-section": COMMENTS_SECTION,
        "virtual:note-comments": NOTE_COMMENTS,
      },
    },
  },
});
