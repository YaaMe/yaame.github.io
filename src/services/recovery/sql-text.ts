import { quoteSqlIdentifier as quote, SqlIdentifierError } from "../../persistence/interactions/sql-text.ts";
import { RecoveryError } from "./errors.ts";

export function quoteSqlIdentifier(value: unknown): string {
  try {
    return quote(value);
  } catch (error) {
    if (error instanceof SqlIdentifierError) {
      throw new RecoveryError("INVALID_RECOVERY_REGISTER", error.message);
    }
    throw error;
  }
}
