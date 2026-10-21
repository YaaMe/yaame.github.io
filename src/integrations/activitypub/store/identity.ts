import { visitorIdentitySchema } from "../../../lib/interactions/records.ts";
import { parseStoredRow } from "./stored-row.ts";

/** The visitor identity a stored row names, or null when the identity schema refuses it. */
export function storedIdentity(id: string, row: { source: string; identifier: string }) {
  return parseStoredRow(visitorIdentitySchema, { id, source: row.source, identifier: row.identifier, name: null });
}
