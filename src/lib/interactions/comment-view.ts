export type CommentLike = {
  id: string;
  replyTo: string | null;
  content?: unknown;
  deletedAt?: string;
};

/**
 * Apply withdrawal state and remove tombstones that no longer have an answer.
 *
 * Removing a withdrawn reply can make its withdrawn parent an unanswered
 * tombstone, so the operation has to reach a fixed point rather than filtering
 * the original list once.
 * An unanswered tombstone is hidden because a line saying someone spoke here
 * is itself a record of them.
 */
export function visibleComments<T extends CommentLike>(
  comments: readonly T[],
  withdrawn: ReadonlyMap<string, string> = new Map(),
): T[] {
  let current = comments.map((comment) => {
    const deletedAt = withdrawn.get(comment.id) ?? comment.deletedAt;
    return deletedAt === undefined
      ? comment
      : ({ ...comment, content: undefined, deletedAt } as T);
  });

  for (;;) {
    const answered = new Set(
      current.map((comment) => comment.replyTo).filter((id): id is string => Boolean(id)),
    );
    const next = current.filter(
      (comment) => comment.content !== undefined || answered.has(comment.id),
    );
    if (next.length === current.length) return next;
    current = next;
  }
}
