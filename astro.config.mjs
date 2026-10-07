// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import { features, site } from "./src/site.config";
import activitypub from "./src/integrations/activitypub";
import auth from "./src/integrations/auth";
import dynamicRoutes from "./src/integrations/dynamic-routes";

// Chosen before the build, not branched on at runtime: the other target's
// implementation never enters the module graph, so its host-only imports never
// have to resolve. See the second architectural rule in CLAUDE.md.
const TARGET = process.env.DEPLOY_TARGET ?? "cloudflare";
const PROFILE = process.env.BUILD_PROFILE ?? "static";

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

  // Under the static profile every route is prerendered, so the adapter emits
  // no server code. Under full, the routes the integrations inject are
  // server-rendered.
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
        "virtual:platform": `/src/platform/${TARGET}.ts`,
      },
    },
  },
});
