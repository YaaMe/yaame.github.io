import { getCollection, render, type CollectionEntry } from "astro:content";

/**
 * The data layer.
 *
 * The design layer (.astro) reads from here and never calls astro:content
 * directly, so that a redesign — or a change of framework — leaves the shape
 * of the data and the rules about it untouched.
 */

export type Post = CollectionEntry<"posts">;

// Ten per page, as Hexo had it. This is part of the URL contract: change it
// and the set of posts on /page/2/ changes with it.
export const PAGE_SIZE = 10;

export async function allPosts(): Promise<Post[]> {
  return (await getCollection("posts")).sort(
    (a, b) => b.data.date.at.getTime() - a.data.date.at.getTime(),
  );
}

// URL contract: /posts/{slug}/
//
// Previously /YYYY/MM/DD/{slug}/, inherited from Hexo. Changed because:
//   - the slugs here are already dates, so the year appeared twice
//   - four path segments carried one document, and the middle ones were
//     not browsable
//   - work still in progress was pinned to a long-stale publication date
// Old links are not redirected; confirmed as not worth preserving.
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
 * The year a post covers, taken from the filename rather than the date.
 *
 * The summaries here are written after the fact: 2025-year was published in
 * 2026-02, 2023-04 in 2023-05. Grouping by publication date would put a post
 * under a heading its own title contradicts. The filename records the period.
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

/** The novel itself, excluding its index page. */
export async function novel(): Promise<Chapter | undefined> {
  return (await komorebi()).find((e) => e.id !== "index");
}

/** Chapter count, from the Han-numeral headings. The design layer should not know this rule. */
export async function chapterCount(): Promise<number> {
  const n = await novel();
  if (!n) return 0;
  return (n.body ?? "").match(/^[一二三四五六七八九十]+$/gm)?.length ?? 0;
}

// ── rendering ───────────────────────────────────────────────

/** Render one entry. Wrapped so the design layer depends only on this module. */
export async function content(entry: Post | Chapter) {
  return render(entry);
}
