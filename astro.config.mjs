// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import { features, site } from "./src/site.config";
import activitypub from "./src/integrations/activitypub";
import auth from "./src/integrations/auth";

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
  integrations: [features.activitypub && activitypub(), features.auth && auth()].filter(Boolean),

  vite: {
    // One value, one source. Without this the page-side copy of site.config
    // would read an undefined process.env and silently fall back.
    define: { __BUILD_PROFILE__: JSON.stringify(PROFILE) },
    resolve: {
      alias: {
        "virtual:platform": `/src/platform/${TARGET}.ts`,
        // The static profile gets the component that renders nothing. Guarding
        // the island with a condition would leave it in the module graph, and
        // a `server:defer` anywhere in the graph makes the build emit a server
        // entry — which that profile is defined by not having.
        "virtual:session": PROFILE === "full"
          ? "/src/integrations/auth/Session.astro"
          : "/src/integrations/auth/Session.off.astro",
      },
    },
  },
});
