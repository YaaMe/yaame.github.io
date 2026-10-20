#!/usr/bin/env node
/**
 * Reconcile withdrawn comments into the git base.
 *
 * The platform entry point supplies JSON rows on stdin and reads the JSON
 * result on stdout. Preview is the default; --apply must be explicit.
 *
 * The runtime delta is authoritative until the git base contains the
 * withdrawal. An open pull request is only a proposal, so it is an input to
 * this reconciliation rather than an acknowledgement stored anywhere.
 */
import { runCommand } from "./comments-cli.mjs";
import { column, rowValue, table } from "./comments-rows.mjs";
import { promotedComments } from "../src/data.config.generated.mjs";
import {
  DIR,
  entryFor,
  readDocuments,
  refEntries,
  writeDocument,
} from "./comments-store.mjs";

const tombstoneWriteBack = promotedComments.writeBack?.find((name) => name === "tombstone");
if (!tombstoneWriteBack) {
  throw new Error("promoted-comments has no tombstone write-back in the data register");
}

export const WITHDRAWAL_STATES = Object.freeze({
  PENDING: "pending",
  PROPOSED: "proposed",
  WRITTEN_BACK: "written back",
});

export function tombstoneSql() {
  return `SELECT ${column("id")}, ${column("deletedAt")} FROM ${table}
   WHERE ${column("deletedAt")} IS NOT NULL`;
}

/**
 * Applied to a fixed point: removing a reply can leave the tombstone above it
 * with nothing left to hold up, so a leaf's departure can make its parent a
 * leaf in turn.
 */
export function rewrite(entries, when) {
  let list = entries;
  for (;;) {
    const answered = new Set(list.map((entry) => entry.replyTo).filter(Boolean));
    const next = [];
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

function sameWithdrawalShape(actual, expected) {
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
export function computeStates({ withdrawn, documents, pullRequestState = () => false }) {
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
    const main = plans
      .map((plan) => ({ plan, entry: entryFor(plan.before, id) }))
      .find(({ entry }) => entry !== undefined);

    if (!main || main.entry.content === undefined) {
      return { id, deletedAt, state: WITHDRAWAL_STATES.WRITTEN_BACK };
    }

    const expected = entryFor(main.plan.after, id);
    const proposed = pullRequestState({
      id,
      deletedAt,
      path: main.plan.path,
      main: main.entry,
      expected,
      before: main.plan.before,
      after: main.plan.after,
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

/** Build the injected PR-state reader from a fetched branch or PR ref. */
export function gitPullRequestState(ref) {
  const proposed = refEntries(ref);
  return ({ path, id, expected }) => sameWithdrawalShape(proposed({ path, id }), expected);
}

function printStates(states) {
  for (const { id, state } of states) console.error(`  ${id}: ${state}`);
}

function changeSummary(plan) {
  const gone = plan.before.comments.length - plan.after.comments.length;
  const stones = plan.after.comments.filter((entry) => entry.deletedAt !== undefined).length;
  return `移除 ${gone} 条，留下 ${stones} 块墓碑（有回复指向）`;
}

export function main({
  apply = false,
  dir = DIR,
  rows,
  pullRequestState,
  prRef,
} = {}) {
  const inputRows = rows;
  if (!Array.isArray(inputRows)) throw new Error("tombstone requires rows on stdin");
  const withdrawn = inputRows.map((row) => ({
    id: rowValue(row, "id"),
    deletedAt: rowValue(row, "deletedAt"),
  }));
  if (withdrawn.length === 0) {
    console.error("  没有要立碑的");
    return { states: [], pending: [], writes: [], changes: [], shouldWrite: false };
  }

  const result = computeStates({
    withdrawn,
    documents: readDocuments(dir),
    pullRequestState: pullRequestState ?? (prRef
      ? gitPullRequestState(prRef)
      : undefined),
  });
  printStates(result.states);

  if (!result.shouldWrite) {
    console.error("  没有待提出的撤回");
    return result;
  }

  let changed = 0;
  for (const plan of result.writes) {
    changed += plan.before.comments.length - plan.after.comments.length;
    changed += plan.after.comments.filter((entry) => entry.deletedAt !== undefined).length;
    console.error(`  ${plan.path}：${changeSummary(plan)}`);
    if (!apply) continue;
    writeDocument(plan.path, plan.after);
  }

  if (changed === 0) {
    console.error("  都已经处理过了");
    return result;
  }
  console.error(`\n  ${changed} 条${apply ? "已处理" : "会被处理"}`);
  return result;
}

await runCommand({ entry: import.meta.url, main, sql: tombstoneSql, hint: true });
