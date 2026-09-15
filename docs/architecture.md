# 设计层与数据层解耦

站点的核心约束:**设计可以整层扔掉重写,数据不受影响。**

## 两层

```
数据层 ── 换设计时一行不动
  src/content/            markdown。纯数据
  src/content.config.ts   字段定义 + 标签校验
  src/tags.ts             标签常量池（唯一真相）
  src/site.config.ts      站点身份、导航、社交
  src/lib/posts.ts        唯一的数据出口
  scripts/*.mjs           补全、校验、创建
  Makefile                操作入口

设计层 ── 可整层替换
  src/layouts/  src/components/  src/pages/  src/styles/
```

## 规则

**设计层不得 import `astro:content`,只能从 `src/lib/posts.ts` 取数据。**

数据出口:

| | |
|---|---|
| `allPosts()` | 全部文章,按发布时间倒序 |
| `href(post)` | URL |
| `periodYear(post)` | 文章覆盖的年份 —— 取自文件名,不是发布日期 |
| `allTags()` | 用到的标签 |
| `pages(n)` / `slice(posts, n)` | 分页 |
| `komorebi()` / `novel()` / `chapterCount()` | 小说 |
| `content(entry)` | 渲染 |

设计层能拿到的东西被这个清单限死。要加新数据,先加在这里。

## 什么属于数据层

判据是:**这条规则是关于内容的,还是关于呈现的。**

`periodYear` 属于数据层 —— 年结月结都是事后写的,"这篇覆盖哪一年"必须从文件名取而非发布日期。这是内容的性质,不是排版决定。

同理,"章节是正文里的中文数字小标题"也是内容规则,所以数章节的逻辑在 `chapterCount()` 里,不在页面里。

## 这条约束买到什么

```
换一套设计     只重写 layouts / components / pages / styles
加 CSS 框架    纯设计层的事，数据层不知情
换掉 Astro     数据层里只有 content.config.ts 和 lib/posts.ts 认识 Astro
               内容、标签池、脚本、Makefile 全部照旧
```

## 例外:URL 形状

`/posts/{slug}/` 是**对外契约**,比两层都长寿。

它实现在 `lib/posts.ts` 的 `href()` 里,但稳定性要求高于数据层本身 —— 换数据层实现可以,换 URL 要当成一次对外的破坏性变更。
