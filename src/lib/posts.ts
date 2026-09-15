import { getCollection, render, type CollectionEntry } from "astro:content";

/**
 * 数据层。
 *
 * 设计层（.astro）只从这里取数据，不直接调 astro:content ——
 * 这样换一套设计（甚至换框架）时，数据的形状和规则不用跟着动。
 */

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

/**
 * 文章覆盖的年份，取自文件名而非发布日期。
 *
 * 本站的年结与月结都是【事后】写的：2025-year 发布于 2026-02，
 * 2023-04 发布于 2023-05。按发布日期分组会让标题和分组对不上。
 * 文件名记的才是这篇覆盖的时段。
 */
export function periodYear(p: Post): string {
  const m = /^(\d{4})/.exec(p.id);
  return m ? m[1] : p.data.date.y;
}

export async function allTags(): Promise<string[]> {
  const t = new Set<string>();
  for (const p of await allPosts()) p.data.tags.forEach((x) => t.add(x));
  return [...t].sort();
}

// ── komorebi ────────────────────────────────────────────────

export type Chapter = CollectionEntry<"komorebi">;

export async function komorebi() {
  return getCollection("komorebi");
}

/** 小说正文（不含索引页）。 */
export async function novel(): Promise<Chapter | undefined> {
  return (await komorebi()).find((e) => e.id !== "index");
}

/** 章节数：数正文里的中文数字小标题。设计层不该知道这个规则。 */
export async function chapterCount(): Promise<number> {
  const n = await novel();
  if (!n) return 0;
  return (n.body ?? "").match(/^[一二三四五六七八九十]+$/gm)?.length ?? 0;
}

// ── 渲染 ────────────────────────────────────────────────────

/** 取一篇的渲染结果。包装 render 是为了让设计层只依赖本模块。 */
export async function content(entry: Post | Chapter) {
  return render(entry);
}
