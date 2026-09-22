import type { APIRoute } from "astro";
import { clearSessionCookie, clearWhoCookie, destroy } from "../session";

export const prerender = false;

/**
 * POST only, answering 204.
 *
 * POST, because a GET is the one method everything feels free to issue
 * unasked: a browser speculatively prefetching the link, a scanner walking
 * the page, a chat client building a preview. That hazard is same-origin —
 * our own menu item, fetched before anyone clicks it.
 *
 * `SameSite=Lax` covers less of this than it looks. It does stop an `<img>`
 * on someone else's page, which is a subresource and carries no cookie. It
 * does NOT stop a link on someone else's page: a top-level GET navigation
 * carries a Lax cookie, so a GET endpoint would log you out from a link
 * anywhere on the web. A cross-site POST is not a top-level GET, so the
 * cookie stays home and the method itself is the guard.
 *
 * 204 rather than the 303 this used to answer: the only caller is `fetch`
 * from the menu, and a redirect there is either followed — downloading the
 * whole of /login to discard it — or has to be explicitly switched off. The
 * caller navigates, because the caller is the one that knows where to.
 */
export const POST: APIRoute = async ({ request }) => {
  // The record goes, not just the cookie. Clearing the cookie alone leaves a
  // copy of it — one taken from a shared machine, say — working until it
  // expires on its own.
  await destroy(request);
  const headers = new Headers();
  headers.append("set-cookie", clearSessionCookie());
  headers.append("set-cookie", clearWhoCookie());
  return new Response(null, { status: 204, headers });
};
