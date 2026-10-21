import { commentsFor, type Comment } from "./comments";
import { withdrawn, withdrawnMany } from "../../selectors/interactions/comments";

/** Read the promoted view after applying withdrawals received by the inbox. */
export async function liveCommentsFor(contentId: string): Promise<Comment[]> {
  return commentsFor(contentId, await withdrawn(contentId));
}

/** Read several promoted views after one batched withdrawal lookup. */
export async function liveCommentsForMany(
  contentIds: string[],
): Promise<Map<string, Comment[]>> {
  const withdrawnByRoot = await withdrawnMany(contentIds);
  return new Map(
    await Promise.all(
      contentIds.map(async (contentId) => [
        contentId,
        await commentsFor(contentId, withdrawnByRoot.get(contentId) ?? new Map()),
      ] as const),
    ),
  );
}
