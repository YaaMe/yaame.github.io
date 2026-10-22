import { allPosts, href } from "./posts";

export async function rssFeed() {
  return {
    title: "Blogu",
    description: "yaame 的随笔与故事",
    items: (await allPosts()).map((post) => ({
      title: post.data.title,
      pubDate: post.data.date.at,
      link: href(post),
      categories: post.data.tags,
    })),
    customData: "<language>zh-Hans</language>",
  };
}
