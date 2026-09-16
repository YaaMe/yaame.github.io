/** Everything the actor's identity depends on, in one place. */
export const AP = {
  // The handle lives on the personal domain, whose DNS is hosted elsewhere and
  // stays there. That domain serves one static WebFinger document pointing
  // here; Fedify still answers for its own host, because a cross-host actor is
  // confirmed with a second lookup against it.
  //
  // The two documents must agree. Changing either means changing both.
  handleHost: "id.yaa.me",
  actorHost: "yaame.dev",
  user: "yaame",
  aliases: ["github"],
} as const;

export const handle = `${AP.user}@${AP.handleHost}`;
// No actorId constant here on purpose. Fedify builds it from origin.webOrigin
// and the dispatcher's path template, and `ctx.getActorUri()` is the only way
// to ask for it — a second copy computed here would agree today and diverge
// the moment the route pattern changes, without anything reporting it.
export const accepted = [
  `acct:${AP.user}@${AP.handleHost}`,
  `acct:${AP.user}@${AP.actorHost}`,
  ...AP.aliases.flatMap((a) => [`acct:${a}@${AP.handleHost}`, `acct:${a}@${AP.actorHost}`]),
];
export const JRD = "application/jrd+json; charset=utf-8";
export const AS2 = "application/activity+json; charset=utf-8";
