/**
 * The outbox, kept apart from federation.ts.
 *
 * It reads the posts, which means astro:content, which exists only inside an
 * Astro build. The queue consumer is a plain Worker and cannot resolve it — so
 * everything the consumer needs stays in federation.ts, and everything that
 * needs the content lives here, imported only from the Astro side.
 */
import { Create, Note } from "@fedify/fedify/vocab";
import { federation } from "./federation";
import { AP } from "./config";
import { allPosts, href } from "../../lib/posts";

const PUBLIC = new URL("https://www.w3.org/ns/activitystreams#Public");

/**
 * The outbox is derived from the posts, not accumulated in storage.
 *
 * The content lives in git, so the activity history is a projection of it: the
 * same commits produce the same outbox, and there is no second copy to drift.
 * Only what arrives from outside — followers, and later replies — needs to be
 * stored.
 */
federation.setOutboxDispatcher(`/users/{identifier}/outbox`, async (ctx, identifier) => {
  if (identifier !== AP.user) return null;

  // One post for now. The shape is the same for the whole archive; publishing
  // the back catalogue at once would deliver sixteen notifications to anyone
  // who follows, which is not how anyone wants to meet an account.
  const posts = (await allPosts()).slice(0, 1);

  return {
    items: posts.map((post) => {
      const url = new URL(href(post), AP.blogUrl);
      return new Create({
        id: new URL("#create", url),
        actor: ctx.getActorUri(identifier),
        to: PUBLIC,
        object: new Note({
          id: url,
          attribution: ctx.getActorUri(identifier),
          url,
          to: PUBLIC,
          content:
            `<p><strong>${post.data.title}</strong></p>` +
            (post.data.description ? `<p>${post.data.description}</p>` : "") +
            `<p><a href="${url}">${url}</a></p>`,
        }),
      });
    }),
  };
});

