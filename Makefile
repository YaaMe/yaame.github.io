# 本站的全部操作入口。`make` 或 `make help` 看清单。
.DEFAULT_GOAL := help
.PHONY: help install dev build preview check frontmatter fix new newpost newtag tags urls links clean

help: ## 显示这份清单
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) \
	  | sed 's/:[^#]*## /\t/' \
	  | awk -F'\t' '{printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

install: ## 安装依赖（锁文件优先）
	npm ci

dev: ## 本地开发服务器
	npx astro dev

build: ## 构建到 dist/
	npx astro build

preview: build ## 构建后本地预览产物
	npx astro preview

check: frontmatter types build links ## 全量校验：frontmatter → 类型 → 构建 → 链接（CI 跑这个）
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

links: ## 检查产物里的内部链接
	@node scripts/check-links.mjs

urls: build ## 列出产物生成的全部 URL
	@find dist -name index.html | sed 's|^dist||; s|/index.html|/|' | sort

clean: ## 清掉构建产物和缓存
	rm -rf dist .astro
