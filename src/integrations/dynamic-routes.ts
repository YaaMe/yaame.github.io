import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

/**
 * Write down which paths the Worker answers for.
 *
 * The link checker reads the build output, where a dynamic route leaves no
 * file — so `/login` looks exactly like a typo. Listing them by hand would be
 * a copy that goes stale the first time a route is added and nobody
 * remembers; this is Astro's own route table, so it cannot disagree.
 *
 * It catches routes nobody wrote, `/_server-islands/[name]` among them, which
 * is why deriving beats enumerating: that one is linked from every page and
 * appears in no file here.
 *
 * Two hooks because neither has both halves: the routes are resolved before
 * the build, and the output directory is only known after it. Nothing is
 * written when every route is prerendered, and the checker reads a missing
 * manifest as "nothing is dynamic", which is then true.
 */
export default function dynamicRoutes(): AstroIntegration {
  let dynamic: string[] = [];
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
