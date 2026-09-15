/**
 * 标签常量池 —— 唯一真相。
 *
 * content.config.ts 用它做构建期校验：不在这里的标签会让构建失败，
 * 而不是默默生成一个新的 /tags/xxx/ 页面。
 * （summarize / summaries 那次拼写漂移就是这么发生的。）
 *
 * 新增标签：在这里加一行，然后 make check。
 */
export const TAGS = {
  summaries: "小结",
  year: "年结",
  month: "月结",
  gugu: "咕",

  // komorebi（小说）
  story: "故事",
  fox_and_priest: "狐狸与道士",
} as const;

export type Tag = keyof typeof TAGS;
export const TAG_SLUGS = Object.keys(TAGS) as [Tag, ...Tag[]];
export const label = (t: string) => (TAGS as Record<string, string>)[t] ?? t;
