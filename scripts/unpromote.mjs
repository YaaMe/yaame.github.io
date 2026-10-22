#!/usr/bin/env node
/**
 * Remove one promoted comment from the archive at the owner's explicit request.
 * The platform entry point supplies rows and deletes the returned comment id
 * after the file write, so a failed database command leaves a retryable source.
 */
import { DIR, readDocuments, writeDocument } from "./comments-store.mjs";
import { runCommand } from "./comments-cli.mjs";
import { deleteSql, planUnpromotion, rowValue, selectSql } from "../src/services/interactions/unpromote.ts";

function textOf(value) {
  if (typeof value === "string") return value.replace(/<[^>]*>/g, " ");
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.label === "string") return value.label;
    if (typeof value.handle === "string") return value.handle;
    if (typeof value.name === "string") return value.name;
    return Object.values(value).map(textOf).join("");
  }
  return value === undefined || value === null ? "" : String(value);
}

function commentSummary(entry, row) {
  const author = entry?.author?.name ?? entry?.author?.identifier ?? rowValue(row, "identifier") ?? "unknown author";
  const firstLine = textOf(entry?.content ?? rowValue(row, "content"))
    .replace(/\r/g, "")
    .split("\n", 1)[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "(empty)";
  return `${author}: ${firstLine}`;
}

export function main({ id, dir = DIR, apply = false, rows } = {}) {
  if (!id) throw new Error("unpromote requires a comment id");
  if (!Array.isArray(rows)) throw new Error("unpromote requires rows on stdin");
  const plan = planUnpromotion({ id, rows, documents: readDocuments(dir) });
  const { archive, d1, entry, row } = plan;
  console.error(archive.present
    ? `  archive: ${archive.path}, entry ${apply ? "removed" : "will be removed"} (${commentSummary(entry, row)})`
    : "  archive: not present");
  console.error(row
    ? `  D1: row ${id} ${apply ? "deleted" : "will be deleted"} (${commentSummary(entry, row)})`
    : "  D1: not present");

  if (!apply) return { changed: true, archive, d1 };

  if (plan.write) writeDocument(plan.write.path, plan.write.after);
  const result = {
    changed: true,
    archive,
    d1,
  };
  if (plan.deleteId !== undefined) result.deleteId = plan.deleteId;
  return result;
}

await runCommand({
  entry: import.meta.url,
  main,
  sql: ({ id, sqlOperation }) => sqlOperation === "delete" ? deleteSql(id) : selectSql(id),
});
