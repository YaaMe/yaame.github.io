import { getCollection } from "astro:content";

/**
 * 短文,按年归档在一堆文件里,读出来是一条时间线。
 *
 * 长文经过转译(标题 + 摘要 + 链接)之后也是一条短文 —— outbox 就是这一条
 * 时间线,不是两个分开的集合。所以这里只负责把年份文件摊平并排序,合并交给
 * 调用方。
 */
export type Note = {
  id: string;
  published: string;
  content: string;
};

/** 新的在前,和长文一致 —— `OrderedCollection` 必须按时间倒序(AP §5)。 */
export async function allNotes(): Promise<Note[]> {
  const years = await getCollection("notes");
  return years
    .flatMap((year) => year.data.notes)
    .sort((a, b) => b.published.localeCompare(a.published));
}
