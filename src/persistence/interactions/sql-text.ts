/**
 * A value as SQL text, for the atomic batches, which bind no parameters.
 *
 * Only for values a stored schema has already accepted: quoting makes a value
 * literal, it does not make it valid.
 */
export const sqlValue = (value: string | null): string =>
  value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;

export class SqlIdentifierError extends Error {}

export function quoteSqlIdentifier(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\u0000")) {
    throw new SqlIdentifierError("SQL identifiers must be non-empty strings without NUL");
  }
  return `"${value.replaceAll('"', '""')}"`;
}
