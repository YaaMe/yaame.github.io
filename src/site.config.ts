/** 站点身份与导航。数据集中在这里，换主题时只换消费方，不重新填一遍。 */
export const site = {
  title: "Blogu",
  author: "yaame",
  url: "https://blogu.yaa.me",
  lang: "zh-Hans",          // 原 Hexo 配置写的是 en，一直是错的
  // TODO: 原 NexT 配置里 subtitle 和 description 都是空的，这句需要你自己写
  description: "",
} as const;

/**
 * 首页顶部那块（astro-paper 里放 "Mingalaba" 的位置）。
 * 两个都留空就整块不渲染，不会留下一个空盒子。
 */
export const hero = {
  greeting: "咕咕",
  intro: "",                 // TODO: 一两句介绍。留空则不显示
} as const;

export const nav = [
  { label: "首页", href: "/" },
  { label: "komorebi", href: "/komorebi/" },
  { label: "RSS", href: "/rss.xml" },
] as const;

export const social = [
  { label: "GitHub", href: "https://github.com/YaaMe" },
  { label: "Email", href: "mailto:i@yaa.me" },

  // 位置留着。等公钥真的成为一条发现渠道时再放出来 ——
  // 见 docs/identity.md §3.5：WKD、代码托管、仓库三处同时发布，
  // 既是发现，也是篡改检测，还是撤销证书的投递路径。
  // 在那之前它只是装饰。
  // { label: "GPG", href: "https://github.com/YaaMe.gpg" },
] as const;
