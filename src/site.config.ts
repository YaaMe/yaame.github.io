interface Site {
  title: string;
  author: string;
  url: string;
  lang: string;
  /** IANA zone. Dates render here, not in the reader's zone or the builder's. */
  timezone: string;
  description: string;
  fingerprint: string;
}

/** Site identity and navigation. Kept here so a redesign swaps the consumer, not the data. */
export const site = {
  title: "Blogu",
  author: "yaame",
  url: "https://blogu.yaa.me",
  lang: "zh-Hans",          // The old Hexo config said "en", which was always wrong

  // The site publishes from here. Frontmatter dates carry an offset, but the
  // /YYYY/MM/DD/ segments must be rendered in THIS zone: rendered as UTC, a
  // 02:22+08:00 timestamp falls back a day and breaks the URL contract.
  timezone: "Asia/Shanghai",

  // TODO: both subtitle and description were empty in the old NexT config
  description: "",

  // The OpenPGP primary key that signs this repository's commits. The full
  // 40-character fingerprint, not the 16-character key ID: a key ID is a
  // truncation of this hash, and the one job this value has is to reveal a
  // substituted key when compared against another channel. Stored unformatted —
  // grouping it into blocks of four is presentation.
  fingerprint: "AD14E09899ECA2C40D518CCB279F27B46C4647E3",
} as const satisfies Site;

/**
 * Feature switches.
 *
 * A `false` here means the feature is NOT BUILT, not that it is built and
 * turned off — only `darkMode` currently gates anything. The rest are named in
 * advance so that adding one is a change in the data layer plus a consumer,
 * rather than a new conditional invented inside a page.
 *
 * Everything the pages already skip — an empty hero, an empty tag list, a post
 * without a description — is driven by the content being absent, and needs no
 * switch. Only add one here for something whose presence is a choice.
 */
export const features = {
  darkMode: true,

  // Federation. Turning this on is what makes the build produce a Worker at
  // all — with it off every route is prerendered and the output is static.
  activitypub: false,

  comments: false,   // not built — see docs/architecture.md before wiring one
  search: false,     // not built
} as const;

/**
 * The block at the top of the index page.
 * With both fields empty the whole section is skipped — no empty box.
 */
export const hero = {
  greeting: "咕咕",
  intro: "",                 // TODO: a sentence or two. Empty means hidden
} as const;

export const nav = [
  { label: "首页", href: "/" },
  { label: "komorebi", href: "/komorebi/" },
  { label: "RSS", href: "/rss.xml" },
] as const;

export const social = [
  { label: "GitHub", href: "https://github.com/YaaMe" },
  { label: "Email", href: "mailto:i@yaa.me" },

  // Slot reserved. Publish this once the public key is actually a discovery
  // channel — served from WKD, the code host and the repository at once, so
  // that it doubles as tamper detection and as the delivery path for a
  // revocation certificate. Until then it is decoration.
  // { label: "GPG", href: "https://github.com/YaaMe.gpg" },
] as const;
