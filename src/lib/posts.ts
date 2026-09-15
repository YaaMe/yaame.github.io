import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;

// Hexo 默认每页 10 篇。这是对外 URL 契约的一部分：
// 改了它，/page/2/ 上有哪些文章就变了。
export const PAGE_SIZE = 10;

export async function allPosts(): Promise<Post[]> {
  return (await getCollection("posts")).sort(
    (a, b) => b.data.date.at.getTime() - a.data.date.at.getTime(),
  );
}

// URL 契约：/posts/{slug}/
//
// 原先是 Hexo 继承来的 /YYYY/MM/DD/{slug}/。改掉的理由：
//   - 本站 slug 本身就是日期（2023-year、2022-04），年份在 URL 里出现两次
//   - 四层路径承载一个文档，中间层不可浏览
//   - 连载中的内容（komorebi）被钉上一个早已过期的发布日期
// 旧链接不做跳转 —— 确认过无需保留。
export function href(p: Post) {
  return `/posts/${p.id}/`;
}

export function pages(total: number) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function slice(posts: Post[], page: number) {
  return posts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

export async function allTags(): Promise<string[]> {
  const t = new Set<string>();
  for (const p of await allPosts()) p.data.tags.forEach((x) => t.add(x));
  return [...t].sort();
}
