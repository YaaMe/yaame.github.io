/** Site identity and navigation. Kept here so a redesign swaps the consumer, not the data. */
export const site = {
  title: "Blogu",
  author: "yaame",
  url: "https://blogu.yaa.me",
  lang: "zh-Hans",          // The old Hexo config said "en", which was always wrong
  // TODO: both subtitle and description were empty in the old NexT config
  description: "",

  // The OpenPGP primary key that signs this repository's commits. The full
  // 40-character fingerprint, not the 16-character key ID: a key ID is a
  // truncation of this hash, and the one job this value has is to reveal a
  // substituted key when compared against another channel. Stored unformatted —
  // grouping it into blocks of four is presentation.
  fingerprint: "AD14E09899ECA2C40D518CCB279F27B46C4647E3",
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
