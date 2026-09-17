import type { APIRoute } from "astro";
import { AP } from "../config";
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
    // A person, not a server: everything here answers activity+json, and the
    // only reason to arrive asking for HTML is that someone pasted the address
    // into a browser.
    //
    // Only the actor's own address is redirected. That one gets copied around
    // and landed on by accident, and 406 is correct and useless to whoever did.
    // The collections and WebFinger are reached on purpose, and answering a
    // specific request with the front page tells that person nothing — least of
    // all why. 406 is the honest answer where the visit was deliberate.
    onNotAcceptable: (request) =>
      /^\/users\/[^/]+$/.test(new URL(request.url).pathname)
        ? Response.redirect(AP.blogUrl, 302)
        : new Response("not acceptable", { status: 406 }),
  });

export const GET = handle;
export const POST = handle;
