import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { rssFeed } from "../selectors/feed";

export const GET: APIRoute = async (context) => rss({
  ...await rssFeed(),
  site: context.site!,
});
