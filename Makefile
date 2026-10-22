# Every operation on this site. `make` or `make help` lists them.
.DEFAULT_GOAL := help
.PHONY: new newpost newtag po fix tags pin unpin follow unfollow promote unpromote tombstone check both test types frontmatter data links urls ap-check recovery-export recovery-import wrangler clean deploy deploy-site deploy-consumer build-consumer help install dev build preview
DEPLOY_TARGET ?= cloudflare
MODE_FLAG = $(if $(filter 1,$(APPLY)),--apply,--dry-run)

help: ## [本地开发] 显示这份清单
	@awk -f scripts/make-help.awk $(MAKEFILE_LIST)

install: ## [本地开发] 安装依赖（锁文件优先）
	npm ci

dev: data ## [本地开发] 本地开发服务器
	npx astro dev

wrangler: ## [维护] 生成 wrangler.jsonc 与绑定类型
	@CF_KV_ID=$${CF_KV_ID:-0000000000000000000000000000000f} \
		CF_D1_ID=$${CF_D1_ID:-00000000-0000-0000-0000-00000000000f} \
		node scripts/wrangler-config.mjs >/dev/null
	@npx wrangler types >/dev/null && echo "  wrangler 配置与类型已生成"

deploy-consumer: data ## [部署] 部署队列消费者（独立 Worker，需要 CF_KV_ID）
	@test -n "$$CF_KV_ID" || { echo "  需要 CF_KV_ID"; exit 1; }
	@node scripts/wrangler-config.mjs worker/wrangler.jsonc worker/wrangler.generated.jsonc
	@cd worker && npx wrangler deploy -c wrangler.generated.jsonc

build-consumer: data ## [部署] 构建队列消费者（使用 worker/ 自己的 wrangler 配置）
	@CF_KV_ID=$${CF_KV_ID:-0000000000000000000000000000000f} \
		CF_D1_ID=$${CF_D1_ID:-00000000-0000-0000-0000-00000000000f} \
		node scripts/wrangler-config.mjs worker/wrangler.jsonc worker/wrangler.generated.jsonc >/dev/null
	@cd worker && npx wrangler deploy -c wrangler.generated.jsonc --dry-run >/dev/null

# Both Workers use src/routes/activitypub/shared.ts, so they deploy
# together. Shipping only the site leaves the inbox listeners running the old
# code while the endpoints that report on them run the new one — every
# diagnostic then describes a world nobody is executing.
deploy: deploy-site deploy-consumer ## [部署] 部署站点与队列消费者（需要真实 CF_KV_ID）

deploy-site: check ## [部署] 只部署站点 Worker
	@test -n "$$CF_KV_ID" || { echo "  部署需要 CF_KV_ID"; exit 1; }
	@node scripts/wrangler-config.mjs >/dev/null
	@node scripts/wrangler-routes.mjs
	@npx wrangler deploy

build: data ## [本地开发] 构建到 dist/（静态产物在 dist/client/）
	npx astro build

preview: build ## [本地开发] 构建后本地预览产物
	npx astro preview

check: wrangler frontmatter data types build test links ## [检查（CI 跑 make check）] 全量校验：配置 → frontmatter → 数据位置 → 类型 → 构建 → 测试 → 链接（CI 跑这个）
	@echo "  ✓ 全部通过"

test: data ## [检查（CI 跑 make check）] 离线行为测试
	@node --experimental-strip-types --test tests/*.test.mjs

data: ## [检查（CI 跑 make check）] 验证并生成数据位置注册表的消费者文件
	@node --experimental-strip-types scripts/data-config.mjs
	@node --experimental-strip-types scripts/data-check.mjs

# Run this before pushing, not make check.
#
# check builds only the profile BUILD_PROFILE names, static by default. What
# exists only under full (dynamic routes, server islands) is then never checked
# locally, and the Workers deploy in CI is the first thing to build it.
# Static runs last, so dist/ is left holding the static build.
both: ## [检查（CI 跑 make check）] 两个 profile 都过一遍（推之前跑）
	@BUILD_PROFILE=full $(MAKE) --no-print-directory check
	@BUILD_PROFILE=static $(MAKE) --no-print-directory check

types: ## [检查（CI 跑 make check）] 类型检查（astro build 不做这件事）
	@npx astro check

frontmatter: data ## [检查（CI 跑 make check）] 检查 frontmatter 是否补全（不写文件）
	@node scripts/frontmatter.mjs --check

fix: data ## [写作] 补全缺失的 description 和 tags（不覆盖已有的）
	@node scripts/frontmatter.mjs

new: data ## [写作] 交互式新建（问你要建文章还是标签）
	@node scripts/new.mjs

# `make po 今天天气不错` passes the words after the target as arguments. This
# happens only when one of these targets is the first goal, and only those
# words get an empty rule: a catch-all `%:` would turn every mistyped target
# into a silent no-op. Use T="…" when the text holds # or $, which make reads
# itself.
ifneq (,$(filter po follow unfollow pin unpin,$(firstword $(MAKECMDGOALS))))
  PO := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  $(eval $(PO):;@:)
endif

pin: data ## [写作] 置顶一篇文章。make pin <slug>
	@node scripts/pin.mjs $(filter-out $@,$(MAKECMDGOALS))

unpin: data ## [写作] 取消置顶。make unpin <slug>
	@node scripts/pin.mjs --remove $(filter-out $@,$(MAKECMDGOALS))

follow: data ## [联邦与评论] 关注一个人。make follow @someone@example.com
	@node scripts/follow.mjs $(filter-out $@,$(MAKECMDGOALS)) $(if $(T),"$(T)",)

unfollow: data ## [联邦与评论] 取关。make unfollow @someone@example.com
	@node scripts/follow.mjs --remove $(filter-out $@,$(MAKECMDGOALS)) $(if $(T),"$(T)",)

po: data ## [写作] 写一条短文。make po 正文 / T="正文" 直接写入；F=draft.md 要加 APPLY=1 才写入
	@node scripts/note.mjs $(if $(T),"$(T)",$(PO)) $(if $(F),--file "$(F)",)

newpost: data ## [写作] 新建文章。P=2026-year / P=2026-09 / P=2026-09-15，T=标题
	@node scripts/newpost.mjs $(P) $(if $(T),--title "$(T)",)

newtag: ## [写作] 新建标签。SLUG=reading LABEL=读书
	@node scripts/newtag.mjs $(SLUG) $(LABEL)

tags: data ## [写作] 列出标签常量池与用量
	@node scripts/tags.mjs

promote: data ## [联邦与评论] 把收下的评论有筛选地拉回 git（APPLY=1 才真的写）
	@APPLY_HINT="make promote APPLY=1" scripts/platform/$(DEPLOY_TARGET)/promote.sh $(MODE_FLAG)

unpromote: data ## [联邦与评论] 从 git 和数据库移除一条已提升评论（APPLY=1 才真的写）
	@ID="$(ID)" scripts/platform/$(DEPLOY_TARGET)/unpromote.sh $(MODE_FLAG)

tombstone: data ## [联邦与评论] 删掉已进 git 而后被撤回的评论，有回复的留墓碑（APPLY=1 才真的写）
	@APPLY_HINT="make tombstone APPLY=1" scripts/platform/$(DEPLOY_TARGET)/tombstone.sh $(MODE_FLAG)

recovery-export: ## [维护] 导出所选设施的 blogu-recovery 文档（APPLY=1 可写入 FILE）
	@$(MAKE) --no-print-directory data >/dev/null
	@scripts/platform/$(DEPLOY_TARGET)/export.sh $(MODE_FLAG) $(if $(FACILITY),--facility "$(FACILITY)",) $(if $(FILE),--file "$(FILE)",)

recovery-import: ## [维护] 预览或导入 blogu-recovery 文档（FILE=…，APPLY=1 才写）
	@$(MAKE) --no-print-directory data >/dev/null
	@scripts/platform/$(DEPLOY_TARGET)/import.sh $(MODE_FLAG) $(if $(FACILITY),--facility "$(FACILITY)",) $(if $(FILE),--file "$(FILE)",)

ap-check: ## [检查（CI 跑 make check）] 对线上 ActivityPub 端点做一致性检查（URL=… 可指定）
	@node scripts/ap-check.mjs $(URL)

links: ## [检查（CI 跑 make check）] 检查产物里的内部链接
	@node scripts/check-links.mjs

urls: build ## [检查（CI 跑 make check）] 列出产物生成的全部 URL
	@find dist/client -name index.html | sed 's|^dist/client||; s|/index.html|/|' | sort

clean: ## [维护] 清掉构建产物和缓存
	rm -rf dist .astro
