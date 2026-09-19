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
   * Off, and off because that was chosen.
   *
   * A consumer cannot tell these apart from absent — Mastodon reads
   * `@json['discoverable'] || false` either way. The difference is on this
   * side: absent is what nobody decided, and it stayed absent for as long as
   * nothing looked. Written down, turning either on is an edit rather than a
   * discovery.
   *
   *   discoverable  appear in directories and suggestions
   *   indexable     content enters the other server's full-text search
   */
  discoverable: false,
  indexable: false,

  /**
   * How much of the archive the outbox offers. 0 means all of it.
   *
   * Bounds what a reader of the collection sees, and nothing else. Delivery
   * keeps its own record of what it has sent, so this is not a brake on
   * flooding a new follower and must not be used as one. NodeInfo's
   * `localPosts` reports against this window, so changing it makes the
   * reported count and the archive disagree. See docs/decisions/0001.
   */
  published: 0,

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
