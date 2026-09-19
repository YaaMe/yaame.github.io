# 0008. Post URLs carry the slug alone

Status: accepted
Date: 2026-09-19

## Context

The site was Hexo before it was Astro, and inherited its URL shape:
`/YYYY/MM/DD/{slug}/`.

## Decision

`/posts/{slug}/`, trailing slash always.

## Rejected

**Keeping the dated path.** Three things were wrong with it here, as opposed to
on a blog in general:

- the slugs are themselves dates (`2025-year`, `2023-07`), so the year appeared
  twice in the path;
- four path segments carried one document, and the middle two were not
  browsable — nothing answered `/2023/` or `/2023/07/`;
- a post still being written was pinned to whatever publication date it was
  created with, which for the long-running pieces was badly stale.

**Redirecting the old links.** Considered and declined: the traffic did not
justify carrying a second URL space forever.

## Consequences

- Links published before the move are broken and stay broken.
- This is an external contract, not a refactor. Changing it again breaks every
  link a reader or a search engine holds, and there is no redirect layer to
  soften it.
- `/tags/{tag}/` and `/komorebi/` follow the same rule.
