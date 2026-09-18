/**
 * CI 用的 Cloudflare API token —— 声明式的那一份。
 *
 * **这份文件没有被 apply 过。** 它在 docs/ 下是文档,不是基础设施:目前 token 是
 * 在面板上手工建的。放在这里是因为那几项权限原本只存在于对话记录和报错里 ——
 * 每一项都是撞了一次墙才知道要加的,而墙上没写。
 *
 * 要真的用它:
 *
 *   terraform init && terraform plan
 *
 * 权限组的名字必须和 Cloudflare 那边**逐字**一致,而下面这些是按惯例写的、
 * 没有逐一核对过。核对的办法:
 *
 *   GET /accounts/{account_id}/tokens/permission_groups
 *
 * 或者让 plan 去报错 —— 名字对不上时数据源会返回空列表,索引 [0] 直接失败。
 *
 * 每一项后面记的是"不给它会怎样",因为那才是它存在的理由。
 */

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

variable "account_id" {
  type        = string
  description = "6bbc51e37e666bc494a80799aa8cc7b8"
}

variable "zone_id" {
  type        = string
  description = "yaame.dev 的 zone id"
}

locals {
  account = "com.cloudflare.api.account.${var.account_id}"
  zone    = "com.cloudflare.api.zone.${var.zone_id}"

  # 名字 → 为什么需要它
  account_permissions = {
    # 缺它什么都发不出去
    "Workers Scripts Write" = "上传两个 Worker 的代码与静态资源"
    # AP_KV 绑定
    "Workers KV Storage Write" = "关注者名单、actor 指纹、已投递记录"
    # producer 与 consumer 两侧
    "Queues Write" = "投递队列的绑定与消费者配置"
    # 只读：Tombstones 那个 job 只 SELECT，写 promoted_at 是本地 make promote 做的
    "D1 Read" = "Tombstones job 查「已进 git 而后被撤回」的评论"
  }

  zone_permissions = {
    # 部署带自定义域的 Worker 要动 zone。账号级的 Workers 权限盖不到这里，
    # 这一项是单独撞出来的。
    "Workers Routes Write" = "yaame.dev 与 blogu.yaame.dev 两个自定义域"
  }
}

data "cloudflare_account_api_token_permission_groups" "account" {
  for_each   = local.account_permissions
  account_id = var.account_id
  name       = urlencode(each.key)
}

data "cloudflare_account_api_token_permission_groups" "zone" {
  for_each   = local.zone_permissions
  account_id = var.account_id
  name       = urlencode(each.key)
}

resource "cloudflare_api_token" "ci" {
  name = "blogu CI"

  policies = [
    {
      effect            = "allow"
      permission_groups = [for d in data.cloudflare_account_api_token_permission_groups.account : { id = d.permission_groups[0].id }]
      resources         = jsonencode({ (local.account) = "*" })
    },
    {
      effect            = "allow"
      permission_groups = [for d in data.cloudflare_account_api_token_permission_groups.zone : { id = d.permission_groups[0].id }]
      resources         = jsonencode({ (local.zone) = "*" })
    },
  ]
}

/**
 * 不在这里的东西,以及为什么:
 *
 * - **D1 Write** —— 只有本地的 `make promote` 会写 `promoted_at`,用的是你自己的
 *   登录,不是这个 token。CI 只读。
 * - **User Details Read** —— wrangler 会提示缺它,那只影响它打印你的邮箱。
 * - **Memberships Read** —— 配了 `CLOUDFLARE_ACCOUNT_ID` 就不需要。**故意不给**:
 *   一旦 wrangler 需要去查 memberships,说明 account id 没配上,那正是该失败的
 *   时候;给了它,部署会成功,但发到一个没人声明过的账号上。
 * - **Secrets Store** —— 密钥用的是每个 Worker 自己的 secret,不走那个服务。
 */
