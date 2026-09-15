/**
 * The tag registry — single source of truth.
 *
 * content.config.ts validates against it at build time: a tag that is not
 * listed here fails the build, rather than quietly producing a /tags/xxx/
 * page nobody will ever visit. (That is how the summarize/summaries
 * spelling drift happened.)
 *
 * To add a tag: add a line here, then `make check`.
 */
export const TAGS = {
  summaries: "小结",
  year: "年结",
  month: "月结",
  gugu: "咕",

  // komorebi (the novel)
  story: "故事",
  fox_and_priest: "狐狸与道士",
} as const;

export type Tag = keyof typeof TAGS;
export const TAG_SLUGS = Object.keys(TAGS) as [Tag, ...Tag[]];
export const label = (t: Tag) => TAGS[t];
