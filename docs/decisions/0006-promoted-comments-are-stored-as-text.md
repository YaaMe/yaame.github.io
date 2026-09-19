# 0006. Promoted comments are stored as text, not as the sender's markup

Status: accepted
Date: 2026-09-19

## Context

A reply arrives as ActivityStreams with an HTML `content` field, written by
whatever software the author used. `scripts/promote.mjs` carries selected
replies from the runtime database into `src/content/comments/`, where they
become part of the repository and are rendered by the site.

What lands in git is a choice between the sender's markup and plain text.

## Decision

Text. `toText()` converts the HTML, keeping paragraphs as blank lines and
turning `<a href="U">T</a>` into `T（U）`.

## Rejected

**Storing the sender's HTML.** The reason is not safety, though it settles that
too. It is presentation: storing HTML fixes another implementation's markup
choices into our content, and any later redesign of the site has to fight that
markup before it can style anything. Text keeps the rendering ours, and the one
conversion we do control — the outbound one, to Mastodon — stays fixed and
written here.

**Adding a sanitiser.** This follows from the above rather than being weighed
against it: there is no untrusted markup left to sanitise.

## Consequences

- `toText()` parses HTML with regular expressions, which is the wrong tool for a
  sanitiser and the right one here. The difference is whether the output is
  escaped: this output is plain text and is escaped at render time, so a
  mis-parse is ugly. A sanitiser's output goes onto the page verbatim, and every
  one of its edge cases is a security boundary.
- Anchor text and its target stop being one thing. Acceptable for the shape this
  content has, which is sentences with links after them.
- Rendering a comment on the site is escape, newline→paragraph, auto-link. No
  dependency, and no markup to trust.
