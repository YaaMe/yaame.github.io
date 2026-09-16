import type { AstroIntegration } from "astro";

/**
 * The paths Fedify answers for.
 *
 * Every dispatcher registered in federation.ts needs a matching entry here, or
 * the request never reaches the Worker: static assets answer first, and an
 * unmatched path gets the 404 page rather than falling through. A dispatcher
 * without its route is silent — the actor advertises the endpoint and the
 * endpoint 404s.
 */
const PATHS = [
  "/.well-known/webfinger",
  "/.well-known/nodeinfo",
  "/nodeinfo/[version]",
  "/users/[user]",
  "/users/[user]/inbox",
  "/users/[user]/followers",
  "/users/[user]/outbox",
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
      "astro:config:setup": ({ injectRoute, logger }) => {
        const entrypoint = new URL("./routes/federated.ts", import.meta.url).pathname;
        for (const pattern of PATHS) injectRoute({ pattern, entrypoint });
        logger.info(`${PATHS.length} federated routes injected`);
      },
    },
  };
}
