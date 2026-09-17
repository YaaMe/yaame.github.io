import type { APIRoute } from "astro";
import { AP } from "../config";
import { federation } from "../federation";
// Registers the outbox dispatcher; only the Astro build can resolve its imports.
import "../outbox";

// On-demand: these are the only dynamic routes the site has, and their presence
// is what makes a Worker exist at all. With the feature off they are never
// injected and the build produces static files alone.
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
 *                  it. These are visited on purpose. 406 was technically
 *                  correct and read as a broken endpoint — which, after a day
 *                  spent removing endpoints that were advertised and did not
 *                  answer, is the same defect wearing a correct status code.
 */
const handle: APIRoute = async ({ request }) => {
  const path = new URL(request.url).pathname;
  const wantsHtml =
    request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");

  if (wantsHtml && ACTOR.test(path)) return Response.redirect(AP.blogUrl, 302);

  // Asked again as a machine would, so Fedify produces the document it has
  // rather than refusing. Only the label changes on the way back out.
  const headers = new Headers(request.headers);
  if (wantsHtml) headers.set("accept", AS2);

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
