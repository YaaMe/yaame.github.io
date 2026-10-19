/**
 * A value as SQL text, for the atomic batches, which bind no parameters.
 *
 * Only for values a stored schema has already accepted: quoting makes a value
 * literal, it does not make it valid.
 */
export const sqlValue = (value: string | null): string =>
  value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
