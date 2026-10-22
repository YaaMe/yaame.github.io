import { AP } from "../../config/activitypub.ts";
export { keyPairs, actorKeys } from "../../gateways/activitypub/keys.ts";

export function actorData(identifier: string) {
  return {
    identifier,
    name: "yaame",
    // Mastodon renders this as HTML; plain text leaves the address unlinked.
    summary: '<p>随笔、年结月结，以及一部还在写的小说，都在 ' +
      `<a href="${AP.blogUrl}/">${new URL(AP.blogUrl).host}</a>。</p>`,
    url: new URL(AP.blogUrl),
    // The avatar is part of the identity; a third party's URL can disappear.
    iconUrl: new URL("/images/avatar.jpg", AP.blogUrl),
    // Verification depends on the target linking back to this actor with rel=me.
    attachments: [
      { name: "Blog", value: `<a rel="me" href="${AP.blogUrl}/">${new URL(AP.blogUrl).host}</a>` },
      { name: "Code", value: '<a rel="me" href="https://github.com/YaaMe">github.com/YaaMe</a>' },
      { name: "OpenPGP", value: "AD14 E098 99EC A2C4 0D51 8CCB 279F 27B4 6C46 47E3" },
    ],
    discoverable: AP.discoverable,
    indexable: AP.indexable,
    since: AP.since,
    manuallyApprovesFollowers: AP.manuallyApprovesFollowers,
  };
}
