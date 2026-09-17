# 配置

这份文档给读代码的人和 AI 用:每一项配置在哪里、谁改、什么时候被读、开错了会发生什么。

**最需要知道的是最后一节的交互表** —— 单项的含义容易猜,组合的含义不容易。

## 一览

| 配置项 | 在哪 | 何时读 | 谁改 |
|---|---|---|---|
| `BUILD_PROFILE` | 环境变量 | 构建前 | CI / 部署者 |
| `DEPLOY_TARGET` | 环境变量 | 构建前 | 部署者 |
| `CF_KV_ID` | 环境变量 → `wrangler.jsonc` | 构建前、部署时 | CI 仓库变量 |
| `features.*` | `src/site.config.ts`,由 `BUILD_PROFILE` 推导 | 构建期 | 作者(改推导规则) |
| `site.*` | `src/site.config.ts` | 构建期 | 作者 |
| `AP.*` | `src/integrations/activitypub/config.ts` | 构建期 | 作者 |
| `routes` / 绑定 | `wrangler.jsonc.template` | 部署时 | 部署者 |

---

## `BUILD_PROFILE` — `static`(默认) / `full`

决定这次构建产出哪一个站点。两者**不是同一个站点的两份副本**,是两个产品。

| | `static` | `full` |
|---|---|---|
| 地址 | `blogu.yaa.me` | `blogu.yaame.dev` |
| 托管 | GitHub Pages | Cloudflare Worker |
| 产物 | 只有 `dist/client/` | 加上 `dist/server/` |
| `features.activitypub` | 关 | 开 |
| canonical | 指自己 | 指自己 |

它被读两次,在两个不同的运行时里:Node 加载 `astro.config.mjs` 时走 `process.env`,Vite 把页面模块转换后走 `define` 注入的 `__BUILD_PROFILE__`。`src/site.config.ts` 两个来源都读 —— **只读一个的话,同一个文件会因为"谁 import 的"而给出不同答案**,曾经导致 canonical 和 RSS 指向两个不同域名。

## `DEPLOY_TARGET` — `cloudflare`(默认) / `node`

决定 `virtual:platform` 解析到 `src/platform/` 下的哪个文件,以及用哪个 Astro adapter。

选中之外的那个实现**不进模块图**,所以它里面的宿主专有 import(`cloudflare:workers`、`node:*`)不需要在别的平台上存在。这是 `CLAUDE.md` 第二条架构规则的实现方式。

`node` 那份目前不存在。

## `CF_KV_ID`

Workers KV 的 namespace id,替换 `wrangler.jsonc.template` 里的 `${CF_KV_ID}`。

- `make check` 时用占位值即可 —— 类型生成只需要配置**可解析**,与 id 的真假无关
- `make deploy` 要求真值,缺了直接失败:绑错 KV 的部署比失败的部署更糟

不是密钥,所以在 CI 里是仓库变量而非 secret。它只暴露"账号里有这个资源",凭它访问不了任何东西。

## `features.*`

由 `BUILD_PROFILE` 推导,不单独设置。

| | 含义 |
|---|---|
| `darkMode` | 页脚的明暗切换按钮 |
| `activitypub` | 联邦。**开着才会产出 Worker** —— 其余路由都是预渲染的 |
| `comments` / `search` | **`false` 表示没做**,不是"做了但关掉" |

## `site.*`

`title` / `author` / `lang` / `description` 是资料。另外三项有约束:

- **`url`** 跟随 `BUILD_PROFILE`,决定 canonical、RSS 链接、以及 actor 里指向博客的地址
- **`timezone`** 是发布时区。日期若按 UTC 渲染,`02:22+08:00` 会退一天,`/YYYY/MM/DD/` 的 URL 契约就破了
- **`fingerprint`** 是 OpenPGP 主密钥指纹,40 位不是 16 位 —— 16 位是这个哈希的截断,而它唯一的职能就是被拿去跨渠道比对

## `AP.*`

| | 值 | 说明 |
|---|---|---|
| `handleHost` | `id.yaa.me` | handle 里 `@` 后面那段。**协议规定 WebFinger 由它提供**,没有间接层 |
| `actorHost` | `yaame.dev` | actor 实际所在。和上一项不同是有意的 |
| `user` | `yaame` | |
| `aliases` | `["github"]` | **目前没接** —— 手写实现时用的,Fedify 走自己的逻辑 |

`actorHost` 一旦有了关注者就**不能改** —— actor id 写在每个关注者的库里,换它等于账号迁移。

`handleHost` 与 actor 不同域时,`id.yaa.me` 上那份静态 WebFinger 必须与 Fedify 生成的一致。Mastodon 会做二次确认,两侧对不上账号在对面不可见。

## `wrangler.jsonc.template`

由 `make wrangler` 生成 `wrangler.jsonc`。两处需要知道:

- **`routes`** 会被 adapter 丢掉。`scripts/wrangler-routes.mjs` 在构建后补回 `dist/server/wrangler.json`,否则部署成功但自定义域从未创建
- **adapter 会剥掉 `queues`(消费者)、`durable_objects`、`migrations`、`workflows`**,只保留 `queues.producers`。所以 Astro 的 Worker 能入队,不能消费 —— 队列消费者必须是另一个 Worker

## 交互

单项的含义好猜,组合的不好猜:

| 组合 | 结果 |
|---|---|
| `BUILD_PROFILE=static` | `activitypub` 强制关,不产出 Worker,`CF_KV_ID` 与 `DEPLOY_TARGET` 都无关 |
| `BUILD_PROFILE=full` + 无 `CF_KV_ID` | `make deploy` 失败;`make check` 仍可跑 |
| `activitypub=true` 但路由未注入 | actor 宣传一个 404 的端点。**不报错** —— 分发器和 `PATHS` 是一对 |
| `platform.queue=false` | 投递同步发出,失败即丢。这是当前状态 |
| `DEPLOY_TARGET=node` | 目前无实现,构建会失败 |

## 不在这个仓库里

- **Cloudflare 的边缘跳转规则**,把 apex 上非联邦路径导向博客。不能做成中间件:静态资源先于 Worker 被服务,未匹配的路径由 assets 直接答 404,Worker 不会被调用
- **`id.yaa.me` 仓库**,提供 handle 域的 WebFinger
- **GitHub 仓库变量 `CF_KV_ID`**
