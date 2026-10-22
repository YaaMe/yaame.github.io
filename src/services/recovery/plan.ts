import type { RecoveryRegister, LayerKind, RecoveryImportRequest } from "./index.ts";
import { RecoveryError, importRecovery } from "./index.ts";

export function requireEmptyDestination(existing: boolean, reason?: string | null): void {
  if (existing) throw new Error(`cannot import into a non-empty store${reason ? `: ${reason}` : ""}`);
}

export function requireExisting(existing: unknown): asserts existing is boolean {
  if (typeof existing !== "boolean") {
    throw new RecoveryError("INVALID_RECOVERY_RECORDS", "recovery input existing must be a boolean");
  }
}

export async function planRecoveryImport<Write>({ register, document, kind, facility, existing, existingReason }: {
  register: RecoveryRegister;
  document: unknown;
  kind: LayerKind;
  facility: (request: RecoveryImportRequest) => Write[] | Promise<Write[]>;
  existing: unknown;
  existingReason?: string | null;
}) {
  requireExisting(existing);
  try {
    requireEmptyDestination(existing, existingReason);
  } catch (error) {
    throw new RecoveryError("RECOVERY_IMPORT_FAILED", (error as Error).message);
  }
  const writes: Write[] = [];
  const result = await importRecovery({
    register,
    document,
    facilities: {
      [kind]: {
        async import(request: RecoveryImportRequest) {
          writes.push(...await facility(request));
        },
      },
    },
  });
  return { ...result, writes };
}
