import { commentsFor, rootIdFor, type Comment } from "./comments";
import { withdrawn, withdrawnMany } from "../../integrations/activitypub/store/comments";

/** Read the promoted view after applying withdrawals received by the inbox. */
export async function liveCommentsFor(slug: string): Promise<Comment[]> {
  return commentsFor(slug, await withdrawn(rootIdFor(slug)));
}

/** Read several promoted views after one batched withdrawal lookup. */
export async function liveCommentsForMany(
  slugs: string[],
): Promise<Map<string, Comment[]>> {
  const withdrawnByRoot = await withdrawnMany(slugs.map(rootIdFor));
  return new Map(
    await Promise.all(
      slugs.map(async (slug) => [
        slug,
        await commentsFor(slug, withdrawnByRoot.get(rootIdFor(slug)) ?? new Map()),
      ] as const),
    ),
  );
}
