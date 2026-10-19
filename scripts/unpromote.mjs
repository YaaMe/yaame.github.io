#!/usr/bin/env node
/**
 * Remove one promoted comment from the archive at the owner's explicit request.
 * The platform entry point supplies rows and deletes the returned comment id
 * after the file write, so a failed database command leaves a retryable source.
 */
import { column, rowValue, table } from "./comments-rows.mjs";
import { DIR, locate, readDocuments, writeDocument } from "./comments-store.mjs";
import { runCommand } from "./comments-cli.mjs";

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function selectSql(id) {
  return `SELECT ${column("id")}, ${column("root")}, ${column("identifier")},
            ${column("content")} FROM ${table}
   WHERE ${column("id")} = ${sqlLiteral(id)}`;
}

export function deleteSql(id) {
  return `DELETE FROM ${table} WHERE ${column("id")} = ${sqlLiteral(id)}`;
}

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
  const row = rows.find((candidate) => rowValue(candidate, "id") === id);
  const located = locate(readDocuments(dir), id);
  const entry = located?.document.comments[located.index];

  if (!row && !located) {
    throw new Error(`Not a promoted comment: ${id} is in neither the archive nor D1`);
  }
  const archive = located
    ? { present: true, path: located.path, entry }
    : { present: false };
  const d1 = row ? { present: true, id } : { present: false };
  console.error(located
    ? `  archive: ${located.path}, entry ${apply ? "removed" : "will be removed"} (${commentSummary(entry, row)})`
    : "  archive: not present");
  console.error(row
    ? `  D1: row ${id} ${apply ? "deleted" : "will be deleted"} (${commentSummary(entry, row)})`
    : "  D1: not present");

  if (!apply) return { changed: true, archive, d1 };

  if (located) {
    writeDocument(located.path, {
      ...located.document,
      comments: located.document.comments.filter((_, index) => index !== located.index),
    });
  }
  const result = {
    changed: true,
    archive,
    d1,
  };
  if (row) result.deleteId = id;
  return result;
}

await runCommand({
  entry: import.meta.url,
  main,
  sql: ({ id, sqlOperation }) => sqlOperation === "delete" ? deleteSql(id) : selectSql(id),
});
