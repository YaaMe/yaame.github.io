import type { MiddlewareHandler } from "astro";
import { site } from "../../site.config";
import { AP } from "./config";

/**
 * The apex is the identity host, not a third address for the blog.
 *
 * One Worker answers for both hostnames, so without this every page would also
 * be reachable at yaame.dev — a copy nobody published and nothing points to.
 * Fedify's own paths are left alone; everything else is sent to the site.
 */
const FEDERATED = /^\/(\.well-known|users|inbox|nodeinfo)(\/|$)/;

export const onRequest: MiddlewareHandler = (ctx, next) => {
  const { hostname, pathname, search } = ctx.url;
  if (hostname !== AP.actorHost || FEDERATED.test(pathname)) return next();
  return ctx.redirect(site.url + pathname + search, 302);
};
