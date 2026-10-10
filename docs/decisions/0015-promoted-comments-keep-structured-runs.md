# 0015. Promoted comments keep structured runs, not sender HTML

Status: accepted
Date: 2026-10-11

## Context

A promoted reply arrives as Mastodon-style HTML, but the archive must not carry
another application's markup. The old text conversion kept a link's label and
target as one string, and it detached mentions and hashtags from the accounts
and tags they identify. Those are data relationships, not presentation.
This decision supersedes 0006's storage format while keeping its no-stored-HTML
and template-owned-rendering reasons.

## Decision

Store `content` as an array of paragraphs. Each paragraph is an array of typed
runs:

- `text`: `{ text }`
- `link`: `{ href, label }`
- `mention`: `{ href, handle }`
- `hashtag`: `{ href, name }`

Only `http` and `https` targets become linked runs. Other targets become a text
run. Promotion converts the incoming markup into this JSON; it does not
sanitise markup. The template escapes every string and creates the anchor for
each run itself, with no `set:html`.

## Rejected

**Storing the sender's HTML.** It fixes another implementation's markup into
the archive and would make a redesign depend on that markup. Structured data
keeps the relationships we need while leaving presentation to the site.

**Flattening to plain text.** It loses the target attached to a link and the
identity attached to a mention or hashtag. Rebuilding links from text cannot
recover those relationships reliably.

**Adding a sanitiser.** Promotion is a format conversion, not a sanitiser. No
sender markup is stored or passed to the page; the template renders escaped
run values and owns the only HTML that is emitted.

## Consequences

- The archive contains no HTML, and the renderer has explicit cases for every
  run type.
- Mastodon paragraphs and line breaks remain paragraph and text structure;
  truncated links retain their target and displayed label.
- A future run type requires a schema case and a template case together.
- Existing promoted entries would need a conversion if any existed. None are
  archived yet, so no migration is required.
