import { column, table } from "./comment-rows.ts";
import { sqlValue } from "./sql-text.ts";
import { SOURCES } from "../../models/interactions/key-scheme.ts";

export function promotionSql() {
  return `SELECT ${(["id", "source", "identifier", "authorId", "activityId", "objectId", "inReplyTo", "root", "replyTo", "content", "published"] as const).map(column).join(", ")}
     FROM ${table}
     WHERE ${column("deletedAt")} IS NULL AND ${column("source")} = '${SOURCES.activitypub}'
     ORDER BY ${column("published")} ASC`;
}

export function tombstoneSql() {
  return `SELECT ${column("id")}, ${column("deletedAt")} FROM ${table}
   WHERE ${column("deletedAt")} IS NOT NULL`;
}

export function selectSql(id: string) {
  return `SELECT ${column("id")}, ${column("root")}, ${column("identifier")},
            ${column("content")} FROM ${table}
   WHERE ${column("id")} = ${sqlValue(String(id))}`;
}

export function deleteSql(id: string) {
  return `DELETE FROM ${table} WHERE ${column("id")} = ${sqlValue(String(id))}`;
}

