import type { AstroIntegration } from "astro";

/**
 * The paths the login answers for.
 *
 * Declared here rather than placed under src/pages, so that leaving the
 * integration out leaves nothing behind: no routes, and nothing that would
 * make the static profile build a Worker it is not supposed to have.
 */
const ROUTES = [
  { pattern: "/login", file: "login.astro" },
  { pattern: "/auth/github", file: "github.ts" },
  { pattern: "/auth/github/callback", file: "callback.ts" },
  { pattern: "/auth/logout", file: "logout.ts" },
];

export default function auth(): AstroIntegration {
  return {
    name: "auth",
    hooks: {
      "astro:config:setup": ({ injectRoute, logger }) => {
        for (const { pattern, file } of ROUTES) {
          injectRoute({
            pattern,
            entrypoint: new URL(`./routes/${file}`, import.meta.url).pathname,
          });
        }
        logger.info(`${ROUTES.length} auth routes injected`);
      },
    },
  };
}
