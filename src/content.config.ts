import { defineCollection } from "astro:content";
// zod comes from the package, not from astro:content — that re-export is
// deprecated in Astro 7. The version is pinned to the one Astro itself uses,
// so a schema written here is the schema the content layer runs.
import { z } from "zod";
import { glob } from "astro/loaders";
import { TAG_SLUGS } from "./tags";
import { site } from "./site.config";

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: site.timezone, year: "numeric", month: "2-digit", day: "2-digit",
});

// Tags must come from the registry in src/tags.ts. A typo fails the build
// rather than producing a /tags/xxx/ page nobody will visit.
const tags = z
  .union([z.string(), z.array(z.string()), z.null()])
  .optional()
  .transform((t) => (t == null ? [] : Array.isArray(t) ? t : [t]))
  .pipe(z.array(z.enum(TAG_SLUGS)));

const stamped = z.coerce.date().transform((d) => {
  const [y, mo, day] = ymd.format(d).split("-");
  return { at: d, y, mo, d: day, iso: d.toISOString() };
});

const base = {
  title: z.string(),
  /**
   * 置顶。
   *
   * 放在文章自己身上,不是配置里列一串 slug —— 置顶是这篇文章的属性,而 slug
   * 改名时这里会跟着走,配置里那份则会悄悄变成指向空处的一行。
   *
   * 联邦那边读的是 actor 的 `featured` 集合,而那是**新访客一来就能看到内容的
   * 唯一入口**:Mastodon 从不回补远端的 outbox,只有这个集合它会主动去抓。
   */
  pinned: z.boolean().default(false),
  // Filled in by scripts/frontmatter.mjs; hand-written values are never overwritten
  description: z.string().optional(),
  tags,
};

/**
 * Promoted comments — the ones chosen to keep.
 *
 * In git rather than read from the database at request time, so both profiles
 * show the same thing: the static site has no database, and a comment that
 * appeared on one domain and not the other would make the two sites disagree
 * about the same post.
 *
 * Grouped by what they hang off:
 *
 *   posts/<slug>.json      a blog post — a long-lived anchor, one file each
 *   notes/<YYYY>.json      short posts, by year — there will be many, and one
 *                          file per short post would be a directory of scraps
 *
 * Which is why every entry carries `rootId` even though the post files could
 * infer it from their name: the yearly files cannot, and one schema for both
 * beats two that drift. Should a year ever grow unwieldy, splitting it is
 * mechanical — every entry already knows its post and its date.
 *
 * Deletion replaces a comment's content with a tombstone rather than removing
 * the entry — see docs/interactions.md — and that is an in-place edit here,
 * which reads far better in a pull request than a file disappearing.
 */
const comment = z.object({
  /**
   * The activity id. Required, not decorative: when a Delete arrives for a
   * comment already carried into git, this is what the removal is raised
   * against.
   */
  activityId: z.url(),
  objectId: z.url(),
  /** The post this hangs off. Redundant in posts/, load-bearing in notes/. */
  rootId: z.url(),
  actorId: z.url(),
  /** Absent once the comment has been withdrawn; the record of it stays. */
  content: z.string().optional(),
  published: z.string(),
  replyToId: z.url().nullable().default(null),
  /** Set when a Delete arrived after this was promoted. */
  deletedAt: z.string().optional(),
});

/**
 * 短文 —— 自己写的、没有标题的那种。
 *
 * 按年一个文件,一条一个文件太碎;而短文没有标题、标签、正文结构,本来就更像
 * 记录而不是文档,JSON 比 markdown 文件合身。正文仍然当 markdown 看 ——
 * 纯文字也是合法的 markdown,而带链接的短文如果不解析就只能显示裸 URL。
 *
 * `id` 和时间分开:一天发几条都有可能,时间当不了身份。而且短文的 id 是
 * 非日期形状的短串,长文的 slug 是日期形状(`2025-year`、`2023-07`),两者
 * 共用 `/users/…/notes/` 这个命名空间也不会撞。
 */
const notes = defineCollection({
  loader: glob({ base: "./src/content/notes", pattern: "**/*.json" }),
  schema: z.object({
    notes: z.array(
      z.object({
        id: z.string().regex(/^[a-z0-9]{6,12}$/, "短随机串，不要日期形状"),
        published: z.string(),
        content: z.string(),
      }),
    ),
  }),
});

export const collections = {
  notes,
  comments: defineCollection({
    loader: glob({ base: "./src/content/comments", pattern: "**/*.json" }),
    schema: z.object({ comments: z.array(comment) }),
  }),
  posts: defineCollection({
    loader: glob({ base: "./src/content/posts", pattern: "**/*.md" }),
    schema: z.object({ ...base, date: stamped }),
  }),
  komorebi: defineCollection({
    loader: glob({ base: "./src/content/komorebi", pattern: "**/*.md" }),
    // index.md still carries a leftover Hexo `type` field: accepted, unused
    schema: z.object({ ...base, date: stamped.optional(), type: z.any().optional() }),
  }),
};
