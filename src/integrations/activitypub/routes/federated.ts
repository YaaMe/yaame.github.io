import type { APIRoute } from "astro";
import { AP } from "../config";
import { federation } from "../federation";
// Registers the outbox dispatcher; only the Astro build can resolve its imports.
import "../outbox";

// On demand. A route that is not prerendered is what makes the build produce a
// Worker. With the feature off these are never injected.
export const prerender = false;

const AS2 = "application/activity+json";
const ACTOR = /^\/users\/[^/]+$/;

/**
 * One handler behind every federated path. Fedify resolves the request against
 * its own router — actor, inboxes, collections, WebFinger, NodeInfo — so the
 * paths are declared once, in the integration, rather than implied by files.
 *
 * Everything here answers activity+json, so a browser is always asking for a
 * representation that does not exist. Two different things are right depending
 * on which address it asked for:
 *
 *   the actor      redirect to the blog. That address gets copied around and
 *                  landed on by accident, and what the person wanted was the
 *                  person.
 *   anything else  the same document, labelled as JSON so the browser renders
 *                  it. These are visited on purpose, and a 406, though
 *                  correct, reads as a broken endpoint.
 */
const handle: APIRoute = async ({ request }) => {
  const path = new URL(request.url).pathname;
  const accept = request.headers.get("accept") ?? "";
  const get = request.method === "GET";
  const wantsHtml = get && accept.includes("text/html");

  // `*/*`, or no Accept at all, means every representation is acceptable —
  // RFC 7231 §5.3.2, and 406 is for when none of them is. Fedify refuses it, so
  // without this a plain `curl` gets 406 from an endpoint that has the
  // document, which looks exactly like a broken endpoint.
  const anything = get && (accept.trim() === "" || /^\s*\*\/\*\s*(;.*)?$/.test(accept));

  if (wantsHtml && ACTOR.test(path)) return Response.redirect(AP.blogUrl, 302);

  // Asked again as a machine would, so Fedify produces the document it has
  // rather than refusing. Only the label changes on the way back out, and only
  // for the browser.
  const headers = new Headers(request.headers);
  if (wantsHtml || anything) headers.set("accept", AS2);

  const response = await federation.fetch(new Request(request, { headers }), {
    contextData: undefined,
    onNotFound: () => new Response("not found", { status: 404 }),
    onNotAcceptable: () => new Response("not acceptable", { status: 406 }),
  });

  if (!wantsHtml) return response;
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};

export const GET = handle;
export const POST = handle;
