/** Everything the actor's identity depends on, in one place. */
export const AP = {
  // A subdomain rather than the apex: the apex cannot take a CNAME and shares
  // its name with five MX records, so pointing it anywhere is the one change
  // here that could stop mail. A subdomain is a CNAME, touches nothing else,
  // and is still the same domain as far as identity goes.
  handleHost: "id.yaa.me",
  actorHost: "yaame.dev",
  user: "yaame",
  aliases: ["github"],
} as const;

export const handle = `${AP.user}@${AP.handleHost}`;
export const actorId = `https://${AP.actorHost}/users/${AP.user}`;
export const accepted = [
  `acct:${AP.user}@${AP.handleHost}`,
  `acct:${AP.user}@${AP.actorHost}`,
  ...AP.aliases.flatMap((a) => [`acct:${a}@${AP.handleHost}`, `acct:${a}@${AP.actorHost}`]),
];
export const JRD = "application/jrd+json; charset=utf-8";
export const AS2 = "application/activity+json; charset=utf-8";
