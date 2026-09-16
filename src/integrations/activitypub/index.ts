import type { AstroIntegration } from "astro";

/** The paths Fedify answers for. Declared here so they are visible in one place. */
const PATHS = [
  "/.well-known/webfinger",
  "/.well-known/nodeinfo",
  "/nodeinfo/[version]",
  "/users/[user]",
  "/users/[user]/inbox",
  "/users/[user]/followers",
  "/inbox",
];

/**
 * ActivityPub as a removable part.
 *
 * Routes are injected rather than placed under src/pages, which buys three
 * things: the feature can be left out by not adding the integration, the paths
 * are declared instead of implied, and /.well-known/* becomes reachable at all —
 * Astro's directory scan skips names that begin with a dot.
 *
 * Left out, nothing here is built: no routes, no Fedify in the module graph,
 * and — since every other route is prerendered — no Worker either.
 */
export default function activitypub(): AstroIntegration {
  return {
    name: "activitypub",
    hooks: {
      "astro:config:setup": ({ injectRoute, addMiddleware, logger }) => {
        const entrypoint = new URL("./routes/federated.ts", import.meta.url).pathname;
        for (const pattern of PATHS) injectRoute({ pattern, entrypoint });
        addMiddleware({
          entrypoint: new URL("./middleware.ts", import.meta.url).pathname,
          order: "pre",
        });
        logger.info(`${PATHS.length} federated routes injected`);
      },
    },
  };
}
