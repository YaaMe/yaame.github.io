import type { AstroIntegration } from "astro";
import { GITHUB_CALLBACK_PATH } from "../../schemas/auth-urls.ts";

/**
 * The paths the login answers for.
 *
 * Declared here rather than placed under src/pages, so that leaving the
 * integration out leaves nothing behind: no routes, and nothing that would
 * make the static profile build a Worker it is not supposed to have.
 */
const ROUTES = [
  { pattern: "/login", file: "../../pages-extra/auth/login.astro" },
  { pattern: "/auth/github", file: "../../routes/auth/github.ts" },
  { pattern: GITHUB_CALLBACK_PATH, file: "../../routes/auth/callback.ts" },
  { pattern: "/auth/logout", file: "../../routes/auth/logout.ts" },
];

export default function auth(): AstroIntegration {
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
