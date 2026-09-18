/**
 * 决定哪些评论进 git。
 *
 * 这是**你编辑的文件**。默认只保留你回复过的那些线程 —— 保守,因为把陌生人的话
 * 放进公开仓库是一个不可撤销的承诺:git 是永久的、被索引的、全世界可读的,而
 * 对方写下那句话时并不知道会落到这里。
 *
 * filter 拿到的是**一整条线程**,不是单条评论。判断需要上下文:只看一条的话,
 * "保留整条回复链"根本表达不出来。返回要留的那些。
 */

/** 保留这些作者写的每一条。 */
export const byAuthor = (actors) => (thread) =>
  thread.filter((c) => actors.includes(c.actorId));

/** 线程里有任意一条命中,整条都留。 */
export const wholeThread = (match) => (thread) =>
  thread.some(match) ? thread : [];

/** 一条都不留。 */
export const nothing = () => [];

/**
 * 当前生效的规则。
 *
 * 默认 `nothing` —— 不是因为它有用,是因为**默认值不该替你做这个决定**。改成
 * 下面注释里的样子,或者写你自己的:
 *
 *   export default byAuthor(["https://mstdn.jp/users/someone"]);
 *   export default wholeThread((c) => c.actorId.startsWith("https://mstdn.jp/"));
 *   export default (thread) => (thread.length <= 3 ? thread : []);
 */
export default nothing;
