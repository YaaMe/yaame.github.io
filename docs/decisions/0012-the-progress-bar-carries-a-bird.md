# 0012. The progress bar carries a bird

Status: accepted
Date: 2026-09-21

## Context

At 1440px the content column is 578px wide and the two margins are 431px
each — 60% of the screen holding nothing, in two symmetric slabs. The page
reads as dense in the middle and empty at the sides, which is the opposite of
the low information density it is trying to have.

Widening the measure is not the fix. 34em is already ~34 Han characters, the
upper end of comfortable for Chinese; more width buys balance by spending
readability.

The first four proposals all filled the margin with **information** —
sidenotes, a live table of contents, reading progress, arriving federation
activity. Every one of them makes the stated problem worse: more to read is
not the answer to "too much to read."

## Decision

A character-art bird stands on a horizontal line fixed to the bottom of the
viewport, and its position along that line is the reading progress. Six
characters:

```
(o)>
 ''
```

Decoration and function are the same object. The bird is not an ornament
beside a progress bar; it is the progress bar's only visible mark.

**One form on every device.** Desktop and phone both get the bottom strip —
no vertical rail, no second composition, no breakpoint. A side view walking
down a vertical line does not mean anything, and a bird that is progress on
one device and decoration on another means two different things at once.

**Movement is a blink, not a walk.** One eye character swaps every 4.3s for
6% of the cycle. The silhouette never moves on its own: 94% of the time the
bird is completely still, and the blink is the whole of the delight. The
horizontal travel is not animation in the relevant sense — it is direct
manipulation, tied to the scroll.

**Scroll-driven, so no JavaScript.** `animation-timeline: scroll(root block)`
binds `left` to scroll progress natively: no listener, no throttling, no
jank. Where it is unsupported the bird sits at the start and the page is
otherwise unaffected.

### Numbers that were measured, not chosen

- **Line at `bottom: .55rem`.** An apostrophe's ink stops 4.0px above the
  `<pre>`'s bottom edge (canvas `actualBoundingBoxDescent` at 12.8px
  monospace); the bird sits at `.3rem` = 4.8px; so the feet land at 8.8px.
  Eyeballing this first gave `.44rem`, 5.8px low, because the sweep's range
  topped out below the right answer. **Re-measure if the size or the mono
  stack changes** — this number is a property of the glyph, not a taste.
- **Bar height `2.6rem`.** Two lines at 12.8px plus the offset is 30.4px;
  2.6rem leaves 11px between the bird and the text scrolling under it.
- **Bar cost on a phone:** 42px of ~750px, 5.6%. The cat this replaced needed
  54px, 7.2%.

## Rejected

**A cat.** The original idea, and it fails twice. Three lines cost 54px of a
phone's vertical space against the bird's 28–42px; and compressed to two
lines its silhouette stops being a cat — ears and body collide.

**`(o>` without the closing paren.** The shape that felt right in a terminal
and does not survive being looked at: `(` curves away and `>` points away, so
nothing encloses the eye and it reads as three pieces of punctuation. `)`
closes the body and the whole thing becomes a bird. Found by rendering it at
40px and looking, after two batches of candidates built on the broken form.

**`||` for legs.** A full character height of vertical line turns the bird
into a side table. `''` sits high and short, which is what a bird's feet do.

**A tail (`,(o)>`).** More legible as a bird, but the tail has to move, and
continuous movement in peripheral vision competes with reading. The blink is
rare enough to be a surprise rather than a presence.

**Filling the margin with information.** See Context — it is the wrong
answer to this particular problem, however right it is for Tufte or gwern.

## Consequences

- **The original problem is not solved.** Moving progress to the bottom left
  the margins as empty as they were. A full-width line gives the page a base
  so the column stops floating, which is a composition fix, not a fill.
- A monospace stack is now needed. The site has none — there is no `pre` or
  `code` styling at all — so this adds a token.
- `line-height: 1` must be set locally: the body's 1.85 stretches character
  art to twice its height.
- `aria-hidden` and `user-select: none` are not optional. A screen reader
  would otherwise read the bird aloud as punctuation, and a select-all would
  paste it into the middle of the text.
- `prefers-reduced-motion` stops the blink and leaves the scroll travel,
  because those are different kinds of motion.
- Support was verified in Chrome 153 only. Safari is the engine on iPhone,
  which is exactly where the bottom strip matters, and it is untested.
- `src/components/Progress.astro` carries it, dropped into `Base.astro` after
  `<main>`, so it is on every page. `prototypes/bird.html` stays as the place
  to look at it without the site around it.
