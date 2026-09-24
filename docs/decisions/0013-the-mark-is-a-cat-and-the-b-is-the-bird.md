# 0013. The mark is a cat, and the b is the bird

Status: accepted
Date: 2026-09-24

## Context

The site had no mark: the header was the word "Blogu" in the body face, and
the browser tab showed the host's default icon. The only drawn thing on the
site was the bird on the progress bar (0012).

## Decision

**The mark is a cat**, drawn in one line: two ears, a round head, two dot
eyes, an ω mouth. It follows the author's avatar, which is a cat, and it is
the author's choice rather than the outcome of a comparison.

**The wordmark replaces the B with the bird.** A lowercase b whose bowl is the
bird's body, with the eye inside and the beak after it, followed by "logu".
The header carries both: cat, then wordmark.

- **One colour.** Both are `--fg-primary`. Hover turns them `--active`, like
  every other link in the header; neither holds an accent at rest, so
  `--active` keeps meaning "you are touching this".
- **Two drawings of the cat.** The favicon is a filled silhouette, eyes cut
  out, on a rounded ink square: the header's line drawing scaled to 16px
  merges into a blot.
- **The favicon carries its own ground.** A tab can be light or dark
  independently of the OS, and `prefers-color-scheme` inside a favicon reports
  the OS. Rendered at 16px on a dark tab colour with the OS light, the
  theme-following version all but vanished: ink on a dark ground.
- **Each blinks as what it is.** The b is a bird, so it blinks like the bar's
  bird — `o` swapped for `-`, same period, same keyframes, in step with it.
  The cat has a rhythm of its own: a slow blink, about a second from closing
  to open, every 9.7s against the birds' 4.3s. Neither moves otherwise, and both stop under
  `prefers-reduced-motion`.

## Rejected

**The bird as the mark.** One character across the whole site: the reader
meets it in the header and again on the bar. It is the obvious proposal and
it was drawn — the `(o)>` art rendered as a glyph. It lost on preference,
and on legibility: a circle with a dot at 16px reads as an eye, while ears
survive any size.

**The cat only in the favicon, the header wordmark alone.** Keeps the page to
a single visible character. Offered side by side; the author chose the cat in
the header as well.

**A cat modelled on the avatar.** The avatar is Chi, from *Chi's Sweet Home*.
The mark is an original line cat and must stay one — drawing towards Chi
makes it someone else's character.

## Consequences

- A page shows a cat and two birds at once: the header's cat and b, and the
  bar's bird. That is accepted, not overlooked.
- The wordmark is drawn, so `site.title` no longer reaches the header text. A
  rename means redrawing, and the header keeps `aria-label={site.title}` so
  assistive technology still reads the name.
- The favicon hardcodes `--ink` and `--paper`; it cannot read the page's
  custom properties. A change to either token means changing it there too.
- Safari's support for SVG favicons is untested. There is no PNG fallback or
  `apple-touch-icon` yet.
- `prototypes/logo.html` holds all the candidates, to look at without the
  site around them.
