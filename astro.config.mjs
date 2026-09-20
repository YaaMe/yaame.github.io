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
  // answered 404, measured.
  trailingSlash: "ignore",
  build: { format: "directory" },

  // Every route is still prerendered, so this produces no server output until
  // something opts out with `export const prerender = false`.
  adapter: TARGET === "node" ? node({ mode: "standalone" }) : cloudflare(),

  // Absent from the array when the feature is off, so nothing it pulls in —
  // Fedify included — is ever reached by the bundler.
  integrations: [
    features.activitypub && activitypub(),
    features.auth && auth(),
    // Always on: it records whatever the other two left behind, and writes
    // nothing when they left nothing.
    dynamicRoutes(),
  ].filter(Boolean),

  vite: {
    // One value, one source. Without this the page-side copy of site.config
    // would read an undefined process.env and silently fall back.
    define: { __BUILD_PROFILE__: JSON.stringify(PROFILE) },
    resolve: {
      alias: {
        "virtual:platform": `/src/platform/${TARGET}.ts`,
      },
    },
  },
});
