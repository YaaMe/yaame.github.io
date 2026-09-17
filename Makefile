# 本站的全部操作入口。`make` 或 `make help` 看清单。
.DEFAULT_GOAL := help
.PHONY: help install dev deploy deploy-site deploy-consumer ap-check build preview check frontmatter fix new newpost newtag tags urls links clean

help: ## 显示这份清单
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) \
	  | sed 's/:[^#]*## /\t/' \
	  | awk -F'\t' '{printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

install: ## 安装依赖（锁文件优先）
	npm ci

dev: ## 本地开发服务器
	npx astro dev

wrangler: ## 生成 wrangler.jsonc 与绑定类型
	@CF_KV_ID=$${CF_KV_ID:-0000000000000000000000000000000f} \
		node scripts/wrangler-config.mjs >/dev/null
	@npx wrangler types >/dev/null && echo "  wrangler 配置与类型已生成"

deploy-consumer: ## 部署队列消费者（独立 Worker，需要 CF_KV_ID）
	@test -n "$$CF_KV_ID" || { echo "  需要 CF_KV_ID"; exit 1; }
	@node scripts/wrangler-config.mjs worker/wrangler.jsonc worker/wrangler.generated.jsonc
	@cd worker && npx wrangler deploy -c wrangler.generated.jsonc

# 两个 Worker 共享 src/integrations/activitypub/，所以它们一起部署。
# 分开部署过一次：inbox 监听器只在 consumer 里执行，而诊断端点在站点
# Worker 里，于是站点报告的是一个与实际执行者无关的世界 —— 连着三次
# 「部署成功」改的都是没在跑的那份代码。
deploy: deploy-site deploy-consumer ## 部署站点与队列消费者（需要真实 CF_KV_ID）

deploy-site: check ## 只部署站点 Worker
	@test -n "$$CF_KV_ID" || { echo "  部署需要 CF_KV_ID"; exit 1; }
	@node scripts/wrangler-config.mjs >/dev/null
	@node scripts/wrangler-routes.mjs
	@npx wrangler deploy

build: ## 构建到 dist/（静态产物在 dist/client/）
	npx astro build

preview: build ## 构建后本地预览产物
	npx astro preview

check: wrangler frontmatter types build links ## 全量校验：配置 → frontmatter → 类型 → 构建 → 链接（CI 跑这个）
	@echo "  ✓ 全部通过"

types: ## 类型检查（astro build 不做这件事）
	@npx astro check

frontmatter: ## 检查 frontmatter 是否补全（不写文件）
	@node scripts/frontmatter.mjs --check

fix: ## 补全缺失的 description 和 tags（不覆盖已有的）
	@node scripts/frontmatter.mjs

new: ## 交互式新建（问你要建文章还是标签）
	@node scripts/new.mjs

newpost: ## 新建文章。P=2026-year / P=2026-09 / P=2026-09-15，T=标题
	@node scripts/newpost.mjs $(P) $(if $(T),--title "$(T)",)

newtag: ## 新建标签。SLUG=reading LABEL=读书
	@node scripts/newtag.mjs $(SLUG) $(LABEL)

tags: ## 列出标签常量池与用量
	@node scripts/tags.mjs

ap-check: ## 对线上 ActivityPub 端点做一致性检查（URL=… 可指定）
	@node scripts/ap-check.mjs $(URL)

links: ## 检查产物里的内部链接
	@node scripts/check-links.mjs

urls: build ## 列出产物生成的全部 URL
	@find dist/client -name index.html | sed 's|^dist/client||; s|/index.html|/|' | sort

clean: ## 清掉构建产物和缓存
	rm -rf dist .astro
