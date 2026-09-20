/**
 * Build profiles.
 *
 * The same source is published twice. `static` is the pure site: every route
 * prerendered, no runtime, no scripts beyond the theme toggle — it will keep
 * working on any file host, indefinitely. `full` adds the parts that need a
 * server, and is where anything experimental lives.
 *
 * They are two products rather than two copies of one, so neither claims to be
 * the canonical version of the other.
 */
// Read twice because this file is loaded twice, in two different runtimes.
// Node loads it for astro.config, where process.env is the only source; Vite
// transforms it for the pages, where process.env is gone and the value arrives
// through `define`. Reading only one of the two makes the same file answer
// differently depending on who imported it — which it did, silently, until the
// canonical link and the RSS feed disagreed.
declare const __BUILD_PROFILE__: string | undefined;
const PROFILE =
  (typeof __BUILD_PROFILE__ !== "undefined" ? __BUILD_PROFILE__ : undefined) ??
  (typeof process !== "undefined" ? process.env.BUILD_PROFILE : undefined) ??
  "static";

// Comments are on in both profiles: they are read from git, not from the
// database, so the static site can show exactly what the full one shows.
export const features = PROFILE === "full"
  ? { darkMode: true, activitypub: true, comments: true, search: false, auth: true }
  : { darkMode: true, activitypub: false, comments: true, search: false, auth: false };

export const profile = PROFILE;

const STATIC = "https://blogu.yaa.me";
const FULL = "https://blogu.yaame.dev";

/** The address of whichever one this build is not. */
export const other = PROFILE === "full" ? STATIC : FULL;

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
  // Each profile publishes to its own address, and each is canonical to
  // itself: they are two products, not two copies of one page.
  url: PROFILE === "full" ? FULL : STATIC,
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
  { label: "notes", href: "/notes/" },
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
