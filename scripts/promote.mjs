#!/usr/bin/env node
/**
 * Reconcile comments selected by the owner's filter into the git base.
 *
 *   make promote          show what would be written, touch nothing
 *   make promote APPLY=1  pass --apply and write files locally
 *
 * The database is the inbox and git is the selected public archive. Promotion
 * is add-only: a later filter change never removes an entry from main. The
 * database row remains the source until an owner explicitly runs unpromote.
 */
import filter from "./promote-filter.mjs";
import { runCommand } from "./comments-cli.mjs";
import {
  DIR,
  fileFor,
  readDocuments,
  refEntries,
  writeDocument,
} from "./comments-store.mjs";
import { actorName, computeStates, promotionSql, promotionThreads, selectPromotion } from "../src/services/interactions/promote.ts";

/** Build the injected open-PR reader from a fetched branch or PR ref. */
export function gitPullRequestState(ref) {
  const proposed = refEntries(ref, { preload: true });
  const state = (change) => proposed(change) !== undefined;
  state.documents = proposed.documents;
  return state;
}

function printStates(states) {
  for (const { id, state } of states) console.error(`  ${id}: ${state}`);
}

export async function main({
  apply = false,
  dir = DIR,
  rows,
  documents: suppliedDocuments,
  pullRequestDocuments: suppliedPullRequestDocuments,
  pullRequestState,
  prRef,
  filter: selectedBy = filter,
  fileForComment = fileFor,
  actorNames,
  nameOf = actorNames === undefined ? actorName : (id) => actorNames[id],
} = {}) {
  const inputRows = rows;
  if (!Array.isArray(inputRows)) throw new Error("promote requires rows on stdin");

  const threads = promotionThreads(inputRows);
  const documents = suppliedDocuments ?? readDocuments(dir);
  const { selected, invalid } = await selectPromotion({
    threads, documents, selectedBy, fileForComment, nameOf,
    onInvalid: ({ id, reason }) => console.warn(`  ✗ ${id}: ${reason}`),
  });

  const proposalState = pullRequestState ?? (prRef
    ? gitPullRequestState(prRef)
    : undefined);
  const result = computeStates({
    selected,
    documents,
    fileForComment,
    pullRequestState: proposalState,
    pullRequestDocuments: suppliedPullRequestDocuments ?? proposalState?.documents?.() ?? [],
  });
  printStates(result.states);
  result.invalid = invalid;

  if (result.staleProposal) {
    console.error("  open promotion proposal has entries outside the current selection; it will be regenerated");
  }

  if (!result.shouldWrite) {
    if (invalid.length > 0) console.error(`  ${invalid.length} 条因结构验证失败而跳过`);
    console.error("  没有待提出的提升");
    return result;
  }

  for (const plan of result.writes) {
    console.error(`  ${apply ? "写入" : "将写入"} ${plan.path}：共 ${plan.after.comments.length} 条`);
    if (!apply) continue;
    writeDocument(plan.path, plan.after);
  }

  const changed = result.pending.length;
  if (invalid.length > 0) console.error(`  ${invalid.length} 条因结构验证失败而跳过`);
  console.error(`\n  ${changed} 条${apply ? "已提出" : "会被提出"}`);
  return result;
}

await runCommand({ entry: import.meta.url, main, sql: promotionSql, hint: true });
