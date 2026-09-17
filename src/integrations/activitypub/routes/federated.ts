import type { APIRoute } from "astro";
import { federation } from "../federation";
// Registers the outbox dispatcher; only the Astro build can resolve its imports.
import "../outbox";

// On-demand: these are the only dynamic routes the site has, and their presence
// is what makes a Worker exist at all. With the feature off they are never
// injected and the build produces static files alone.
export const prerender = false;

/**
 * One handler behind every federated path. Fedify resolves the request against
 * its own router — actor, inboxes, collections, WebFinger, NodeInfo — so the
 * paths are declared once, in the integration, rather than implied by files.
 */
const handle: APIRoute = ({ request }) =>
  federation.fetch(request, {
    contextData: undefined,
    onNotFound: () => new Response("not found", { status: 404 }),
    onNotAcceptable: () => new Response("not acceptable", { status: 406 }),
  });

export const GET = handle;
export const POST = handle;
