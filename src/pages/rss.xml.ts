import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { allPosts, href } from "../lib/posts";

export const GET: APIRoute = async (context) => {
  const posts = await allPosts();
  return rss({
    title: "Blogu",
    description: "yaame 的随笔与故事",
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date.at,
      link: href(p),
      categories: p.data.tags,
    })),
    customData: "<language>zh-Hans</language>",
  });
};
