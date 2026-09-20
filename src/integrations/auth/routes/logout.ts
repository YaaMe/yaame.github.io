import type { APIRoute } from "astro";
import { clearSessionCookie, destroy } from "../session";

export const prerender = false;

/**
 * POST only.
 *
 * A GET would be followed by anything that prefetches a link, and by an
 * `<img>` on someone else's page, which turns logging out into something
 * another site can do to you.
 */
export const POST: APIRoute = async ({ request }) => {
  // The record goes, not just the cookie. Clearing the cookie alone leaves a
  // copy of it — one taken from a shared machine, say — working until it
  // expires on its own.
  await destroy(request);
  return new Response(null, {
    status: 303,
    headers: { location: new URL("/login", request.url).href, "set-cookie": clearSessionCookie() },
  });
};
