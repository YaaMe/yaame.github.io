# 0011. Colour tokens name a role, not a value

Status: accepted
Date: 2026-09-21

## Context

`tokens.css` held five custom properties — `--bg`, `--fg`, `--muted`,
`--rule`, `--accent` — each a literal pair under `light-dark()`. They are
values with no stated purpose, and two things followed from that.

A colour that is needed but has no name cannot be asked for. The first
accent-coloured button has no answer for what its text should be, and whatever
is chosen that afternoon will be wrong in one of the two themes, because the
accent inverts between them and the text on it has to invert the other way.

And a name that describes appearance rather than purpose stops being true when
the appearance changes. `--muted` was used 27 times, always as secondary text;
the name records how it looks, so nothing connects those 27 uses to each other.

## Decision

Two layers, following the convention the W3C Design Tokens Community Group's
format module (first stable version, v2025.10) is built around, and which
Material Design 3, GitHub Primer, IBM Carbon, Ant Design and shadcn/ui all
share in some spelling:

```
primitive   --paper --ink --steel …      the only literals
semantic    --bg-page --fg-primary --link …   what a colour is for
```

Nothing outside `tokens.css` refers to the first layer. A component asks for
the role and does not learn which value is filling it.

The pair that did not exist before is `--fg-on-accent`: text on an
accent-coloured ground, inverting opposite to the accent itself.

## Rejected

**The third layer.** The convention is usually three — primitive, semantic,
and one token per component (`--button-bg`). That tier exists because a design
tool exports it; there is no such pipeline here, and hand-maintaining a
per-component tier for ten components is ceremony that would go stale before
it was read.

**A component library's tokens** — Ant Design's seed/map/alias, daisyUI's
theme. Those systems are coherent and their vocabulary is theirs: `primary`,
`secondary`, `base-100`, or in the case read for comparison,
`trading-bullish` and `elevation-popover`. Adopting one means adopting its
opinion about what this site's roles are, and the roles here are a blog's.

**Naming by appearance, kept for continuity.** `--muted` reads fine until the
muted colour stops being muted.

## Consequences

- `light-dark()` covers the whole palette, so dark mode needs no class and no
  variant — the theme button flips `color-scheme` and that is all. This holds
  only while every difference between themes is a colour. A shadow or a border
  width that differs would need a second mechanism, and then both exist.
- The layering is plain CSS custom properties, so it survives a change of
  renderer. Tailwind v4's `@theme` compiles to exactly this, which is why
  adopting it later would not undo this decision.
- **Not settled here:** whether a scale for spacing and type should be enforced
  by a utility framework rather than maintained by hand. Semantic colour does
  not address that, and the drift it would address is real and demonstrable —
  `.9em` with its letter-spacing was copied from the index page into the
  comments component, and several spacing values have no source at all.
