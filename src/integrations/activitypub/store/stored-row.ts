import type { z } from "zod";

/** The row as its stored schema accepts it, or null when the schema refuses it. */
export function parseStoredRow<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
