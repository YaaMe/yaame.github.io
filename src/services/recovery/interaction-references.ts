/**
 * Every reference between interaction rows must resolve inside the same set:
 * a comment's or reaction's author and a follower's id are visitor identities
 * in it, and a comment's replyTo is a comment in it. The database enforces no foreign
 * keys, so a restore that skipped this would leave rows pointing at nothing.
 * Takes rows already accepted by validateInteractionRows.
 */
export function validateInteractionReferences(rowsByKind: ReadonlyMap<string, readonly unknown[]>): void {
  const rows = (kind: string) => (rowsByKind.get(kind) ?? []) as Array<Record<string, unknown>>;
  const identities = new Set(rows("visitor-identities").map((identity) => identity.id));
  const comments = new Set(rows("comments").map((comment) => comment.id));
  for (const kind of ["comments", "reactions"]) {
    for (const row of rows(kind)) {
      if (!identities.has(row.authorId)) {
        throw new Error(`${kind} ${String(row.id)} names author ${String(row.authorId)}, which is not among the visitor identities`);
      }
      if (kind === "comments" && row.replyTo !== null && !comments.has(row.replyTo)) {
        throw new Error(`comments ${String(row.id)} replies to ${String(row.replyTo)}, which is not among the comments`);
      }
    }
  }
  for (const row of rows("followers")) {
    if (!identities.has(row.id)) {
      throw new Error(`followers ${String(row.id)} is not among the visitor identities`);
    }
  }
}
