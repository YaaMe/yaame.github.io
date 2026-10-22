import { commentSchema } from "../../models/content/comments.ts";
import { promotedComments } from "../../config/data.config.generated.mjs";
import { rowValue, type CommentRow } from "../../persistence/interactions/comment-rows.ts";
import { toContent } from "./promote-text.ts";
import { actorName } from "../../gateways/activitypub/actor-profile.ts";
import type { ArchivedComment, ArchiveSnapshot, ArchiveWrite } from "../../selectors/interactions/comment-archive.ts";
import type { z } from "zod";
export { promotionSql } from "../../persistence/interactions/comment-operation-sql.ts";
export { actorName };

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

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function contentLength(content: unknown) {
  return strings(content).reduce((length, value) => length + value.length, 0);
}

function hasControlCharacter(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value);
}

function issueText(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "comment"}: ${issue.message}`)
    .join("; ");
}

/** Validate the entry immediately before it can enter a git document. */
export function validatePromotedComment(entry: unknown) {
  const parsed = commentSchema.safeParse(entry);
  if (!parsed.success) return { ok: false as const, reason: issueText(parsed.error) };
  if (parsed.data.content === undefined) return { ok: false as const, reason: "content is required" };
  if (contentLength(parsed.data.content) > MAX_COMMENT_LENGTH) {
    return { ok: false as const, reason: `content exceeds ${MAX_COMMENT_LENGTH} characters` };
  }
  const control = strings(parsed.data).find(hasControlCharacter);
  if (control !== undefined) return { ok: false as const, reason: "content contains a control character" };
  return { ok: true as const, value: parsed.data };
}

export function promotedComment(row: CommentRow) {
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

/**
 * Compute promotion state from SQL's selected rows, main and an open PR.
 * The open PR is a proposal, so it is read on every run instead of stored in
 * SQL. Additions that are already proposed stay in a regenerated branch when
 * a newer pending addition arrives.
 */
export function computeStates({
  selected,
  documents,
  fileForComment,
  pullRequestState = () => false,
  pullRequestDocuments = [],
}: {
  selected: ArchivedComment[];
  documents: ArchiveSnapshot[];
  fileForComment: ArchivePath;
  pullRequestState?: (change: { id: string; path: string }) => boolean;
  pullRequestDocuments?: ArchiveSnapshot[];
}) {
  const mainById = new Map<string, { path: string; entry: ArchivedComment }>();
  const plansByPath = new Map<string, { path: string; before: ArchiveWrite["before"]; additions: ArchivedComment[] }>(documents.map(({ path, document }) => [path, {
    path,
    before: document,
    additions: [],
  }]));
  const states: Array<{ id: string; state: string; path?: string }> = [];
  const additions: Array<{ path: string; entry: ArchivedComment }> = [];
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

export type PromotionCandidate = ReturnType<typeof promotedComment>;
export type ArchivePath = (root: string) => string | null;
export type PromotionFilter = (thread: PromotionCandidate[]) => PromotionCandidate[] | undefined;

export function promotionThreads(rows: CommentRow[]) {
  const threads = new Map<string, PromotionCandidate[]>();
  for (const row of rows) {
    const comment = promotedComment(row);
    const thread = threads.get(comment.root) ?? [];
    thread.push(comment);
    threads.set(comment.root, thread);
  }
  return threads;
}

export async function selectPromotion({
  threads, documents, selectedBy, fileForComment, nameOf = actorName,
  onInvalid = () => {},
}: {
  threads: Map<string, PromotionCandidate[]>;
  documents: ArchiveSnapshot[];
  selectedBy: PromotionFilter;
  fileForComment: ArchivePath;
  nameOf?: (id: string) => string | undefined | Promise<string | undefined>;
  onInvalid?: (invalid: { id: string; reason: string }) => void;
}) {
  const existingIds = new Set(documents.flatMap(({ document }) =>
    (document.comments ?? []).map(({ id }) => id)));
  const selected: ArchivedComment[] = [];
  const invalid: Array<{ id: string; reason: string }> = [];
  for (const thread of threads.values()) {
    for (const candidate of selectedBy(thread) ?? []) {
      if (selected.some(({ id }) => id === candidate.id)) continue;
      if (fileForComment(candidate.root) === null) {
        invalid.push({ id: candidate.id, reason: "unrecognised root" });
        onInvalid({ id: candidate.id, reason: "unrecognised root" });
        continue;
      }
      let entry: PromotionCandidate & { author: PromotionCandidate["author"] & { name?: string } } = candidate;
      if (!existingIds.has(candidate.id)) {
        const name = await nameOf(candidate.author.identifier);
        if (name) entry = { ...candidate, author: { ...candidate.author, name } };
      }
      const checked = validatePromotedComment(entry);
      if (!checked.ok) {
        invalid.push({ id: candidate.id, reason: checked.reason });
        onInvalid({ id: candidate.id, reason: checked.reason });
        continue;
      }
      selected.push(checked.value);
    }
  }

  return { selected, invalid };
}
