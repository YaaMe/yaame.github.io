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
import { column, rowValue, table } from "./comments-rows.mjs";
import {
  DIR,
  entryFor,
  fileFor,
  readDocuments,
  readRefDocuments,
  writeDocument,
} from "./comments-store.mjs";
import { toContent } from "./promote-text.mjs";
import { commentHref, commentSchema } from "../src/lib/interactions/comment-schema.ts";
import { promotedComments } from "../src/data.config.generated.mjs";
import { SOURCES } from "../src/lib/interactions/key-scheme.ts";
const promoteWriteBack = promotedComments.writeBack?.find((name) => name === "promote");
if (!promoteWriteBack) {
  throw new Error("promoted-comments has no promote write-back in the data register");
}

export const PROMOTION_STATES = Object.freeze({
  PENDING: "pending",
  PROPOSED: "proposed",
  WRITTEN_BACK: "written back",
});
export const MAX_COMMENT_LENGTH = 10_000;

function strings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function contentLength(content) {
  return strings(content).reduce((length, value) => length + value.length, 0);
}

function hasControlCharacter(value) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value);
}

function issueText(error) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "comment"}: ${issue.message}`)
    .join("; ");
}

/** Validate the entry immediately before it can enter a git document. */
export function validatePromotedComment(entry) {
  const parsed = commentSchema.safeParse(entry);
  if (!parsed.success) return { ok: false, reason: issueText(parsed.error) };
  if (parsed.data.content === undefined) return { ok: false, reason: "content is required" };
  if (contentLength(parsed.data.content) > MAX_COMMENT_LENGTH) {
    return { ok: false, reason: `content exceeds ${MAX_COMMENT_LENGTH} characters` };
  }
  const control = strings(parsed.data).find(hasControlCharacter);
  if (control !== undefined) return { ok: false, reason: "content contains a control character" };
  return { ok: true, value: parsed.data };
}

export function promotionSql() {
  return `SELECT ${["id", "source", "identifier", "authorId", "activityId", "objectId", "inReplyTo", "root", "replyTo", "content", "published"].map(column).join(", ")}
     FROM ${table}
     WHERE ${column("deletedAt")} IS NULL AND ${column("source")} = '${SOURCES.activitypub}'
     ORDER BY ${column("published")} ASC`;
}

export function promotedComment(row) {
  return {
    id: rowValue(row, "id"),
    source: rowValue(row, "source"),
    activityId: rowValue(row, "activityId"),
    objectId: rowValue(row, "objectId"),
    inReplyTo: rowValue(row, "inReplyTo"),
    root: rowValue(row, "root"),
    replyTo: rowValue(row, "replyTo"),
    author: {
      id: rowValue(row, "authorId"),
      source: rowValue(row, "source"),
      identifier: rowValue(row, "identifier"),
    },
    content: toContent(rowValue(row, "content")),
    published: rowValue(row, "published"),
  };
}

export async function actorName(actorId) {
  const href = commentHref.safeParse(actorId);
  if (!href.success) return undefined;
  try {
    const response = await fetch(href.data, {
      redirect: "error",
      headers: { accept: "application/activity+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const actor = await response.json();
    const name = typeof actor.name === "string" && actor.name.trim()
      ? actor.name.trim()
      : actor.preferredUsername;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Build the injected open-PR reader from a fetched branch or PR ref. */
export function gitPullRequestState(ref) {
  const documents = new Map(readRefDocuments(ref).map(({ path, document }) => [path, document]));
  const state = ({ path, id }) => {
    return entryFor(documents.get(path), id) !== undefined;
  };
  state.documents = () => [...documents].map(([path, document]) => ({ path, document }));
  return state;
}

/**
 * Compute promotion state from SQL's selected rows, main and an open PR.
 * The open PR is a proposal, so it is read on every run instead of stored in
 * SQL. Additions that are already proposed stay in a regenerated branch when
 * a newer pending addition arrives.
 */
export function computeStates({
  selected,
  documents,
  fileForComment = fileFor,
  pullRequestState = () => false,
  pullRequestDocuments = [],
}) {
  const mainById = new Map();
  const plansByPath = new Map(documents.map(({ path, document }) => [path, {
    path,
    before: document,
    additions: [],
  }]));
  const states = [];
  const additions = [];
  const selectedIds = new Set(selected.map(({ id }) => id));

  for (const document of documents) {
    for (const entry of document.document.comments ?? []) {
      mainById.set(entry.id, { path: document.path, entry });
    }
  }

  for (const entry of selected) {
    const existing = mainById.get(entry.id);
    if (existing) {
      states.push({ id: entry.id, state: PROMOTION_STATES.WRITTEN_BACK });
      continue;
    }

    const path = fileForComment(entry.root);
    if (path === null) continue;
    const proposed = pullRequestState({
      id: entry.id,
      path,
    });
    const state = proposed ? PROMOTION_STATES.PROPOSED : PROMOTION_STATES.PENDING;
    states.push({ id: entry.id, state, path });
    additions.push({ path, entry });
  }

  for (const { path, entry } of additions) {
    const plan = plansByPath.get(path) ?? {
      path,
      before: { comments: [] },
      additions: [],
    };
    plan.additions.push(entry);
    plansByPath.set(path, plan);
  }

  const staleProposal = pullRequestDocuments.some(({ document }) =>
    (document.comments ?? []).some(({ id }) =>
      !selectedIds.has(id) && !mainById.has(id)));

  const writes = [...plansByPath.values()].flatMap((plan) => {
    if (plan.additions.length === 0) return [];
    const commentsBefore = plan.before.comments ?? [];
    const commentsAfter = [...commentsBefore];
    const seen = new Set(commentsAfter.map((entry) => entry.id));
    for (const entry of plan.additions) {
      if (!seen.has(entry.id)) {
        commentsAfter.push(entry);
        seen.add(entry.id);
      }
    }
    commentsAfter.sort((a, b) => a.published.localeCompare(b.published));
    return [{
      path: plan.path,
      before: plan.before,
      after: { ...plan.before, comments: commentsAfter },
      changed: JSON.stringify(commentsBefore) !== JSON.stringify(commentsAfter),
    }];
  }).filter(({ changed }) => changed);

  const pending = states.filter(({ state }) => state === PROMOTION_STATES.PENDING);
  return {
    states,
    pending,
    writes,
    staleProposal,
    shouldWrite: pending.length > 0 || staleProposal,
  };
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

  const threads = new Map();
  for (const row of inputRows) {
    const comment = promotedComment(row);
    const thread = threads.get(comment.root) ?? [];
    thread.push(comment);
    threads.set(comment.root, thread);
  }

  const documents = suppliedDocuments ?? readDocuments(dir);
  const existingIds = new Set(documents.flatMap(({ document }) =>
    (document.comments ?? []).map(({ id }) => id)));
  const selected = [];
  const invalid = [];
  for (const thread of threads.values()) {
    for (const candidate of selectedBy(thread) ?? []) {
      if (selected.some(({ id }) => id === candidate.id)) continue;
      if (fileForComment(candidate.root) === null) {
        invalid.push({ id: candidate.id, reason: "unrecognised root" });
        console.warn(`  ✗ ${candidate.id}: unrecognised root`);
        continue;
      }
      let entry = candidate;
      if (!existingIds.has(candidate.id)) {
        const name = await nameOf(candidate.author.identifier);
        if (name) entry = { ...candidate, author: { ...candidate.author, name } };
      }
      const checked = validatePromotedComment(entry);
      if (!checked.ok) {
        invalid.push({ id: candidate.id, reason: checked.reason });
        console.warn(`  ✗ ${candidate.id}: ${checked.reason}`);
        continue;
      }
      selected.push(checked.value);
    }
  }

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
