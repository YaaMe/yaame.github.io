import { readPosts, readKomorebi, renderContent, type Post, type Chapter } from "../persistence/content/posts";
import { parsePostFilename } from "../models/content/post-filename";
import { label, type Tag } from "../config/tags";
import { calendarDateLabel } from "../models/content/fields";
import { site, hero } from "../config/site.config";

/**
 * The data layer.
 *
 * The design layer (.astro) reads from here and never calls astro:content
 * directly, so that a redesign — or a change of framework — leaves the shape
 * of the data and the rules about it untouched.
 */

export type { Post, Chapter } from "../persistence/content/posts";

// Part of the URL contract: changing it changes which posts are on
// /tags/{tag}/page/{n}/.
export const PAGE_SIZE = 10;

export async function allPosts(): Promise<Post[]> {
  return (await readPosts()).sort(
    (a, b) => b.data.date.at.getTime() - a.data.date.at.getTime(),
  );
}

// URL contract: /posts/{slug}/. Changing it breaks every external link, and
// nothing redirects.
// See docs/decisions/0008-post-urls-carry-the-slug-alone.md.
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
  return parsePostFilename(p.id).yearPrefix ?? p.data.date.y;
}

/**
 * The period a post covers: a label to print, and a value for `datetime`.
 *
 * Three sizes on one axis. A year summary covers a year (`年结`), a month
 * summary a month (`02 月`), an essay the day it was written (`10-18`). The
 * label never includes the year; periodYear supplies that.
 *
 * Taken from the filename, not the publication date, for the reason given on
 * periodYear. A filename without a date falls back to the publication date.
 *
 * Tags also mark `year` and `month`. This does not read them: the filename is
 * the only source, so a mismatched tag cannot change the label.
 */
export function period(p: Post): { label: string; datetime: string } {
  const match = parsePostFilename(p.id).period;
  switch (match?.kind) {
    case "year": return { label: "年结", datetime: match.year };
    case "day": return { label: `${match.month}-${match.day}`, datetime: p.id };
    case "month": return { label: `${match.month} 月`, datetime: p.id };
  }
  return { label: `${p.data.date.mo}-${p.data.date.d}`, datetime: p.data.date.iso };
}

/**
 * Tags in use, narrowed to the registry rather than widened to `string`.
 *
 * Unregistered tags already fail the build, so every value here is a `Tag`.
 * Widening to `string[]` would force callers to cast before comparing against
 * `p.data.tags`.
 */
export async function allTags(): Promise<Tag[]> {
  const t = new Set<Tag>();
  for (const p of await allPosts()) p.data.tags.forEach((x) => t.add(x));
  return [...t].sort();
}


export async function komorebi() {
  return readKomorebi();
}

/** The novel itself, excluding its index page. */
export async function novel(): Promise<Chapter | undefined> {
  return (await komorebi()).find((e) => e.id !== "index");
}

/** Chapter count, from the Han-numeral headings. The design layer should not know this rule. */
export async function chapterCount(): Promise<number> {
  const n = await novel();
  if (!n) return 0;
  return (n.body ?? "").match(/^## [一二三四五六七八九十]+$/gm)?.length ?? 0;
}


/** Render one entry. Wrapped so the design layer depends only on this module. */
export async function content(entry: Post | Chapter) {
  return renderContent(entry);
}

export function tagHref(tag: string) {
  return `/tags/${tag}/`;
}

export function pageHref(base: string, page: number) {
  return page === 1 ? base : `${base}page/${page}/`;
}

export function postDisplay(post: Post) {
  return {
    id: post.id,
    href: href(post),
    title: post.data.title,
    description: post.data.description,
    datetime: post.data.date.iso,
    date: calendarDateLabel(post.data.date),
    tags: post.data.tags.map((tag) => ({ href: tagHref(tag), label: `#${tag}` })),
  };
}

export function postList(posts: Post[], page: number, total: number, base: string) {
  return {
    posts: posts.map(postDisplay),
    pagination: {
      visible: total > 1,
      previous: page > 1 ? pageHref(base, page - 1) : undefined,
      next: page < total ? pageHref(base, page + 1) : undefined,
      label: `${page} / ${total}`,
    },
  };
}

export async function postPage(entry: Post) {
  const { Content } = await content(entry);
  return { ...postDisplay(entry), Content };
}

export function homePage(posts: Post[]) {
  // A month summary must lead its days; reverse filename order puts a longer
  // day filename first. The filename's year also keeps late summaries in place.
  const coarseFirst = (a: string, b: string) =>
    a.startsWith(b) ? 1 : b.startsWith(a) ? -1 : b.localeCompare(a);
  const byYear = new Map<string, { href: string; title: string; period: ReturnType<typeof period> }[]>();
  for (const post of [...posts].sort((a, b) => coarseFirst(a.id, b.id))) {
    const year = periodYear(post);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push({
      href: href(post),
      title: post.data.description || post.data.title,
      period: period(post),
    });
  }
  return {
    title: site.title,
    greeting: hero.greeting,
    years: [...byYear].map(([year, entries]) => ({ year, entries })),
  };
}

export function tagArchive(posts: Post[], tag: Tag) {
  const tagged = posts.filter((post) => post.data.tags.includes(tag));
  return { tagged, total: pages(tagged.length) };
}

export function tagPage(tag: Tag, tagged: Post[], page: number, total: number) {
  return {
    title: page === 1 ? `${label(tag)} · 标签` : `标签：${tag} · 第 ${page} 页`,
    heading: page === 1 ? label(tag) : `标签：${tag}`,
    posts: slice(tagged, page),
    page,
    total,
    base: tagHref(tag),
  };
}

export async function chapterPage(entry: Chapter) {
  const { Content } = await content(entry);
  return { title: entry.data.title, Content };
}
