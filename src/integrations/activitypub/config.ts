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

  /**
   * The blog this actor points at.
   *
   * Fixed rather than taken from site.url, which follows the build profile:
   * the actor advertises one address to the rest of the network, and it should
   * not depend on which of the two sites happened to produce this build. Also
   * keeps this file free of the Astro-only imports the queue consumer cannot
   * resolve.
   */
  blogUrl: "https://blogu.yaame.dev",
} as const;

// No actorId constant here on purpose. Fedify builds it from origin.webOrigin
// and the dispatcher's path template, and `ctx.getActorUri()` is the only way
// to ask for it — a second copy computed here would agree today and diverge
// the moment the route pattern changes, without anything reporting it.
