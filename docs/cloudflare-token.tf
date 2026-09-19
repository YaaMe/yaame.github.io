/**
 * The CI Cloudflare API token, declared.
 *
 * **This file has never been applied.** Under docs/ it is documentation, not
 * infrastructure: the token in use was created by hand in the dashboard. It is
 * written down because otherwise the permission list exists only in error
 * messages — each one was discovered by hitting a wall that did not name it.
 *
 * To actually use it:
 *
 *   terraform init && terraform plan
 *
 * Permission group names must match Cloudflare's **exactly**, and these were
 * written from convention rather than checked one by one. To check:
 *
 *   GET /accounts/{account_id}/tokens/permission_groups
 *
 * Or let plan fail: a name that does not match returns an empty list, and the
 * [0] index fails on it.
 *
 * Each entry records what breaks without it, which is the reason it is there.
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
  description = "the yaame.dev zone id"
}

locals {
  account = "com.cloudflare.api.account.${var.account_id}"
  zone    = "com.cloudflare.api.zone.${var.zone_id}"

  # name → what breaks without it
  account_permissions = {
    # without it nothing ships at all
    "Workers Scripts Write" = "upload both Workers' code and static assets"
    # the AP_KV binding
    "Workers KV Storage Write" = "follower list, actor digest, delivery record"
    # both the producer and the consumer side
    "Queues Write" = "the delivery queue binding and its consumer config"
    # read only: the tombstones job only SELECTs, and promoted_at is written
    # locally by make promote
    "D1 Read" = "the tombstones job, finding comments withdrawn after promotion"
  }

  zone_permissions = {
    # Deploying a Worker with a custom domain touches the zone. The
    # account-level Workers permissions do not reach it; this one is separate.
    "Workers Routes Write" = "the yaame.dev and blogu.yaame.dev custom domains"
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
 * What is deliberately absent, and why:
 *
 * - **D1 Write** — only the local `make promote` writes `promoted_at`, under
 *   your own login rather than this token. CI reads.
 * - **User Details Read** — wrangler warns without it; the effect is that it
 *   cannot print your email address.
 * - **Memberships Read** — unnecessary once `CLOUDFLARE_ACCOUNT_ID` is set, and
 *   **withheld on purpose**: wrangler needing to look up memberships means the
 *   account id did not arrive, which is exactly when the deploy should fail.
 *   Granted, it would succeed instead, against an account nobody declared.
 * - **Secrets Store** — the signing key is a per-Worker secret and does not go
 *   through that service.
 */
