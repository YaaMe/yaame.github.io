#!/usr/bin/env node
/**
 * Reconcile withdrawn comments into the git base.
 *
 *   node scripts/tombstone.mjs          show states and pending changes
 *   APPLY=1 node scripts/tombstone.mjs  write pending changes
 *
 * The runtime delta is authoritative until the git base contains the
 * withdrawal. An open pull request is only a proposal, so it is an input to
 * this reconciliation rather than an acknowledgement stored anywhere.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { comments, promotedComments } from "../src/data.config.generated.mjs";

const APPLY = process.env.APPLY === "1";
const DB = "yaame-ap-interactions";
const DIR = promotedComments.gitRoot;
const commentsColumns = comments.columns;
const column = (name) => comments.quotedColumns[name];
const table = comments.table;
const tombstoneWriteBack = promotedComments.writeBack?.find((name) => name === "tombstone");
if (!tombstoneWriteBack) {
  throw new Error("promoted-comments has no tombstone write-back in the data register");
}

export const TOMBSTONE_WRITE_BACK = tombstoneWriteBack;
export const WITHDRAWAL_STATES = Object.freeze({
  PENDING: "pending",
  PROPOSED: "proposed",
  WRITTEN_BACK: "written back",
});

function query(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const start = out.indexOf("[");
  if (start < 0) throw new Error(`看不懂 wrangler 的输出：${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start))[0].results;
}

export function* files(dir) {
  let entries;
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (name.endsWith(".json")) yield path;
  }
}

export function readDocuments(dir = DIR) {
  return [...files(dir)].map((path) => ({
    path,
    document: JSON.parse(readFileSync(path, "utf8")),
  }));
}

/**
 * Applied to a fixed point: removing a reply can leave the tombstone above it
 * with nothing left to hold up, so a leaf's departure can make its parent a
 * leaf in turn.
 */
export function rewrite(entries, when) {
  let list = entries;
  for (;;) {
    const answered = new Set(list.map((entry) => entry.replyToId).filter(Boolean));
    const next = [];
    let moved = false;
    for (const entry of list) {
      const at = when.get(entry.activityId);
      if (at === undefined && entry.deletedAt === undefined) {
        next.push(entry);
        continue;
      }
      if (!answered.has(entry.objectId)) {
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

function entryFor(document, activityId) {
  const index = document?.comments?.findIndex((entry) => entry.activityId === activityId) ?? -1;
  return index < 0 ? undefined : document.comments[index];
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
  const when = new Map(withdrawn.map(({ activityId, deletedAt }) => [activityId, deletedAt]));
  const plans = documents.map(({ path, document }) => {
    const commentsAfter = rewrite(document.comments, when);
    return {
      path,
      before: document,
      after: { ...document, comments: commentsAfter },
      changed: JSON.stringify(commentsAfter) !== JSON.stringify(document.comments),
    };
  });

  const states = withdrawn.map(({ activityId, deletedAt }) => {
    const main = plans
      .map((plan) => ({ plan, entry: entryFor(plan.before, activityId) }))
      .find(({ entry }) => entry !== undefined);

    if (!main || main.entry.content === undefined) {
      return { activityId, deletedAt, state: WITHDRAWAL_STATES.WRITTEN_BACK };
    }

    const expected = entryFor(main.plan.after, activityId);
    const proposed = pullRequestState({
      activityId,
      deletedAt,
      path: main.plan.path,
      main: main.entry,
      expected,
      before: main.plan.before,
      after: main.plan.after,
    });
    return {
      activityId,
      deletedAt,
      state: proposed ? WITHDRAWAL_STATES.PROPOSED : WITHDRAWAL_STATES.PENDING,
    };
  });

  const pending = states.filter(({ state }) => state === WITHDRAWAL_STATES.PENDING);
  const unwritten = new Set(
    states
      .filter(({ state }) => state !== WITHDRAWAL_STATES.WRITTEN_BACK)
      .map(({ activityId }) => activityId),
  );
  // Rebuild the branch from main with every withdrawal that main does not
  // contain yet. `shouldWrite` remains about pending work only; proposed
  // withdrawals are included here so a new pending withdrawal cannot erase
  // an older proposal when the branch is regenerated.
  const writes = plans.filter(({ before, after, changed }) => changed && (
    before.comments.some(({ activityId }) => unwritten.has(activityId))
    || after.comments.some(({ activityId }) => unwritten.has(activityId))
  ));
  return {
    states,
    pending,
    writes,
    // Keep the descriptive name for callers that only inspect the plan.
    changes: writes,
    shouldWrite: pending.length > 0,
  };
}

function readRefDocument(ref, path) {
  try {
    return JSON.parse(execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" }));
  } catch (error) {
    if (error?.status === 128) return undefined;
    throw error;
  }
}

/** Build the injected PR-state reader from a fetched branch or PR ref. */
export function gitPullRequestState(ref) {
  const documents = new Map();
  return ({ path, activityId, expected }) => {
    if (!documents.has(path)) documents.set(path, readRefDocument(ref, path));
    const proposed = entryFor(documents.get(path), activityId);
    return sameWithdrawalShape(proposed, expected);
  };
}

function printStates(states) {
  for (const { activityId, state } of states) console.log(`  ${activityId}: ${state}`);
}

function changeSummary(plan) {
  const gone = plan.before.comments.length - plan.after.comments.length;
  const stones = plan.after.comments.filter((entry) => entry.deletedAt !== undefined).length;
  return `移除 ${gone} 条，留下 ${stones} 块墓碑（有回复指向）`;
}

export function main({
  apply = APPLY,
  dir = DIR,
  queryRows,
  pullRequestState,
} = {}) {
  const rows = queryRows ?? query(`SELECT ${column("activityId")}, ${column("deletedAt")} FROM ${table}
   WHERE ${column("deletedAt")} IS NOT NULL AND ${column("promotedAt")} IS NOT NULL`);
  const withdrawn = rows.map((row) => ({
    activityId: row[commentsColumns.activityId],
    deletedAt: row[commentsColumns.deletedAt],
  }));
  if (withdrawn.length === 0) {
    console.log("  没有要立碑的");
    return { states: [], pending: [], writes: [], changes: [], shouldWrite: false };
  }

  const result = computeStates({
    withdrawn,
    documents: readDocuments(dir),
    pullRequestState: pullRequestState ?? (process.env.TOMBSTONE_PR_REF
      ? gitPullRequestState(process.env.TOMBSTONE_PR_REF)
      : undefined),
  });
  printStates(result.states);

  if (!result.shouldWrite) {
    console.log("  没有待提出的撤回");
    return result;
  }

  let changed = 0;
  for (const plan of result.writes) {
    changed += plan.before.comments.length - plan.after.comments.length;
    changed += plan.after.comments.filter((entry) => entry.deletedAt !== undefined).length;
    console.log(`  ${plan.path}：${changeSummary(plan)}`);
    if (!apply) continue;
    // An empty file describes a conversation that is not there. `git add` on
    // the directory stages the removal the same as an edit.
    if (plan.after.comments.length === 0) rmSync(plan.path);
    else writeFileSync(plan.path, `${JSON.stringify(plan.after, null, 2)}\n`);
  }

  if (changed === 0) {
    console.log("  都已经处理过了");
    return result;
  }
  console.log(`\n  ${changed} 条${apply ? "已处理" : "会被处理（加 APPLY=1 才动手）"}`);
  return result;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
