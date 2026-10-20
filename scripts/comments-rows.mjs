import { comments } from "../src/config/data.config.generated.mjs";

export const commentsColumns = comments.columns;
export const table = comments.table;

export function column(name) {
  return comments.quotedColumns[name];
}

export function rowValue(row, field) {
  return row[commentsColumns[field]] ?? row[field];
}
