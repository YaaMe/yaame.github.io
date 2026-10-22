import { promotedComments } from "../../config/data.config.generated.mjs";
import { rowValue, type CommentRow } from "../../persistence/interactions/comment-rows.ts";
import { entryFor, locate, type ArchivedComment, type ArchiveSnapshot, type ArchiveWrite } from "../../selectors/interactions/comment-archive.ts";
export { tombstoneSql } from "../../persistence/interactions/comment-operation-sql.ts";

const tombstoneWriteBack = promotedComments.writeBack?.find((name) => name === "tombstone");
if (!tombstoneWriteBack) {
  throw new Error("promoted-comments has no tombstone write-back in the data register");
}

export const WITHDRAWAL_STATES = Object.freeze({
  PENDING: "pending",
  PROPOSED: "proposed",
  WRITTEN_BACK: "written back",
});

/**
 * Applied to a fixed point: removing a reply can leave the tombstone above it
 * with nothing left to hold up, so a leaf's departure can make its parent a
 * leaf in turn.
 */
export function rewrite(entries: ArchivedComment[], when: ReadonlyMap<string, string>) {
  let list = entries;
  for (;;) {
    const answered = new Set(list.map((entry) => entry.replyTo).filter(Boolean));
    const next: ArchivedComment[] = [];
    let moved = false;
    for (const entry of list) {
      const at = when.get(entry.id);
      if (at === undefined && entry.deletedAt === undefined) {
        next.push(entry);
        continue;
      }
      if (!answered.has(entry.id)) {
        moved = true;
        continue;
      }
      if (entry.deletedAt === undefined) {
        const { content, ...rest } = entry;
        next.push({ ...rest, deletedAt: at });
        moved = true;
      } else {
        next.push(entry);
      }
    }
    if (!moved) return list;
    list = next;
  }
}

export function sameWithdrawalShape(actual: ArchivedComment | undefined, expected: ArchivedComment | undefined) {
  if (actual === undefined || expected === undefined) return actual === expected;
  if (expected.content === undefined) {
    return actual.content === undefined && actual.deletedAt === expected.deletedAt;
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/**
 * Compute every withdrawal from the SQL delta, the current git base and the
 * supplied open-PR reader. The reader is deliberately a function: production
 * supplies a git ref, while tests can describe a proposal without GitHub.
 */
export function computeStates({ withdrawn, documents, pullRequestState = () => false }: {
  withdrawn: Array<{ id: string; deletedAt: string }>;
  documents: ArchiveSnapshot[];
  pullRequestState?: (change: {
    id: string; deletedAt: string; path: string; main: ArchivedComment;
    expected: ArchivedComment | undefined; before: ArchiveWrite["before"]; after: ArchiveWrite["after"];
  }) => boolean;
}) {
  const when = new Map(withdrawn.map(({ id, deletedAt }) => [id, deletedAt]));
  const plans = documents.map(({ path, document }) => {
    const commentsAfter = rewrite(document.comments, when);
    return {
      path,
      before: document,
      after: { ...document, comments: commentsAfter },
      changed: JSON.stringify(commentsAfter) !== JSON.stringify(document.comments),
    };
  });

  const states = withdrawn.map(({ id, deletedAt }) => {
    const main = locate(documents, id);
    const entry = main?.document.comments[main.index];

    if (!main || !entry || entry.content === undefined) {
      return { id, deletedAt, state: WITHDRAWAL_STATES.WRITTEN_BACK };
    }

    const plan = plans.find(({ before }) => before === main.document)!;
    const expected = entryFor(plan.after, id);
    const proposed = pullRequestState({
      id,
      deletedAt,
      path: main.path,
      main: entry,
      expected,
      before: plan.before,
      after: plan.after,
    });
    return {
      id,
      deletedAt,
      state: proposed ? WITHDRAWAL_STATES.PROPOSED : WITHDRAWAL_STATES.PENDING,
    };
  });

  const pending = states.filter(({ state }) => state === WITHDRAWAL_STATES.PENDING);
  const unwritten = new Set(
    states
      .filter(({ state }) => state !== WITHDRAWAL_STATES.WRITTEN_BACK)
      .map(({ id }) => id),
  );
  // Rebuild the branch from main with every withdrawal that main does not
  // contain yet. `shouldWrite` remains about pending work only; proposed
  // withdrawals are included here so a new pending withdrawal cannot erase
  // an older proposal when the branch is regenerated.
  const writes = plans.filter(({ before, after, changed }) => changed && (
    before.comments.some(({ id }) => unwritten.has(id))
    || after.comments.some(({ id }) => unwritten.has(id))
  ));
  return {
    states,
    pending,
    writes,
    changes: writes,
    shouldWrite: pending.length > 0,
  };
}

export function withdrawalRows(rows: CommentRow[]) {
  return rows.map((row) => ({
    id: rowValue(row, "id"),
    deletedAt: rowValue(row, "deletedAt")!,
  }));
}
