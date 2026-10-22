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
import { computeStates, sameWithdrawalShape, tombstoneSql, withdrawalRows } from "../src/services/interactions/tombstone.ts";
import { DIR, readDocuments, refEntries, writeDocument } from "./comments-store.mjs";

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
  const withdrawn = withdrawalRows(inputRows);
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
