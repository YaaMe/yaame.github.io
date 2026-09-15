import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// 站点的发布时区。frontmatter 里的日期都带 +08:00 标记，
// 但 URL 里的 /YYYY/MM/DD/ 必须按【这个时区】渲染 ——
// 若按 UTC 渲染，02:22+08:00 这类会退回前一天，破坏对外的链接契约。
const TZ = "Asia/Shanghai";
const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

const tags = z
  .union([z.string(), z.array(z.string()), z.null()])
  .optional()
  .transform((t) => (t == null ? [] : Array.isArray(t) ? t : [t]));

const stamped = z.coerce.date().transform((d) => {
  const [y, mo, day] = ymd.format(d).split("-");
  return { at: d, y, mo, d: day, iso: d.toISOString() };
});

const base = {
  title: z.string(),
  // 由 scripts/frontmatter.mjs 补全；手写的不会被覆盖
  description: z.string().optional(),
  tags,
};

export const collections = {
  posts: defineCollection({
    loader: glob({ base: "./src/content/posts", pattern: "**/*.md" }),
    schema: z.object({ ...base, date: stamped }),
  }),
  komorebi: defineCollection({
    loader: glob({ base: "./src/content/komorebi", pattern: "**/*.md" }),
    // index.md 还带一个 Hexo 遗留的 type 字段，放行但不使用
    schema: z.object({ ...base, date: stamped.optional(), type: z.any().optional() }),
  }),
};
