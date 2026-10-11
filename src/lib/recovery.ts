/**
 * The portable recovery boundary. Facilities own access to a store; this
 * module owns the document shape and the register's selection rule.
 */

export const RECOVERY_FORMAT = "blogu-recovery" as const;
export const RECOVERY_FORMAT_VERSION = 1 as const;

const EXCLUSION_REASONS = Object.freeze({
  rebuild: "rebuild on restore",
  reset: "reset on restore",
  ephemeral: "ephemeral on restore",
  none: "not part of recovery",
});

const LAYER_KINDS = ["git", "sql", "records", "memory", "external", "ref"] as const;
type LayerKind = typeof LAYER_KINDS[number];

export type RecoveryLayer = Record<string, unknown>;
export type RecoveryEntry = {
  layers: RecoveryLayer[];
  recovery: string;
  [key: string]: unknown;
};
export type RecoveryRegister = Record<string, RecoveryEntry>;

export type RecoverySelection = {
  keep: Array<{ kind: string; entry: RecoveryEntry }>;
  leftOut: Array<{ kind: string; recovery: string; reason: string }>;
  ownerHeld: string[];
};

export type RecoveryLayerRecords = { layer: number; records: unknown };
export type RecoveryGitBase = { kind: string; layer: number };
export type RecoveryDocument = {
  format: typeof RECOVERY_FORMAT;
  version: typeof RECOVERY_FORMAT_VERSION;
  entries: Record<string, { records: RecoveryLayerRecords[] }>;
  /** Git layers move with the repository backup SOP and carry no payload here. */
  gitBase: RecoveryGitBase[];
  leftOut: Array<{ kind: string; recovery: string; reason: string }>;
  ownerHeld: string[];
};

export type RecoveryExportRequest = {
  kind: string;
  entry: RecoveryEntry;
  layer: RecoveryLayer;
  layerIndex: number;
};

export type RecoveryImportRequest = RecoveryExportRequest & {
  records: unknown;
};

/** A store adapter implements both halves against one register layer. */
export interface RecoveryFacility {
  export(request: RecoveryExportRequest): unknown | Promise<unknown>;
  import(request: RecoveryImportRequest): void | Promise<void>;
}

export type RecoveryFacilities = Partial<Record<LayerKind, RecoveryFacility>>;

export class RecoveryError extends Error {
  code: string;

  constructor(code: string, message: string, properties: Record<string, unknown> = {}) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
    Object.assign(this, properties);
  }
}

function layerKind(layer: RecoveryLayer): LayerKind | null {
  if (!layer || typeof layer !== "object") return null;
  for (const kind of LAYER_KINDS) {
    if (Object.hasOwn(layer, kind)) return kind;
  }
  return null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value: unknown, label: string): unknown {
  const seen = new WeakSet<object>();
  const check = (candidate: unknown, path: string) => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      if (Number.isFinite(candidate)) return;
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label}${path} is not a finite number`);
    }
    if (typeof candidate !== "object") {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label}${path} is not JSON data`);
    }
    if (seen.has(candidate)) {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label}${path} contains a cycle`);
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => check(item, `${path}[${index}]`));
    } else {
      for (const [key, item] of Object.entries(candidate)) check(item, `${path}.${key}`);
    }
    seen.delete(candidate);
  };
  check(value, "");
  return JSON.parse(JSON.stringify(value));
}

function jsonScalar(value: unknown): boolean {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((key) => actual.includes(key));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function recordKeyMatches(declaration: string, key: string): boolean {
  const pattern = /^([\s\S]*?)\{([A-Za-z][A-Za-z0-9_]*)\}([\s\S]*)$/;
  let rest = declaration;
  let expression = "^";
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rest))) {
    expression += escapeRegex(match[1]) + ".+?";
    rest = match[3];
  }
  expression += escapeRegex(rest) + "$";
  return new RegExp(expression).test(key);
}

function validateSqlRecords(layer: RecoveryLayer, records: unknown, label: string): unknown[] {
  const columnsMap = layer.columns;
  if (!isObjectRecord(columnsMap)) {
    throw new RecoveryError("INVALID_RECOVERY_REGISTER", `${label} has no SQL columns map`);
  }
  if (!Array.isArray(records)) {
    throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label} must be an array of SQL rows`);
  }
  const columns = Object.keys(columnsMap);
  return records.map((row, index) => {
    if (!isObjectRecord(row) || !sameKeys(Object.keys(row), columns)) {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label}[${index}] must use exactly the logical SQL column names`);
    }
    for (const column of columns) {
      if (!jsonScalar(row[column])) {
        throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label}[${index}].${column} must be a JSON scalar`);
      }
    }
    return Object.fromEntries(columns.map((column) => [column, row[column]]));
  });
}

function validateRecordStoreRecords(layer: RecoveryLayer, records: unknown, label: string): unknown {
  if (layer.records === true) return cloneJson(records, label);
  if (typeof layer.records !== "string" || !Array.isArray(records)) {
    throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label} must be an array of keyed records`);
  }
  return records.map((record, index) => {
    if (!isObjectRecord(record) || !sameKeys(Object.keys(record), ["key", "value"])) {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label}[${index}] must contain only key and value`);
    }
    if (typeof record.key !== "string" || !recordKeyMatches(layer.records as string, record.key)) {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${label}[${index}].key does not match the register record key`);
    }
    return { key: record.key, value: cloneJson(record.value, `${label}[${index}].value`) };
  });
}

function validateLayerRecords(layer: RecoveryLayer, records: unknown, label: string): unknown {
  switch (layerKind(layer)) {
    case "sql":
      return validateSqlRecords(layer, records, label);
    case "records":
      return validateRecordStoreRecords(layer, records, label);
    default:
      return cloneJson(records, label);
  }
}

/** Select the register entries that belong in a portable recovery. */
export function selectRecovery(register: RecoveryRegister): RecoverySelection {
  const selection: RecoverySelection = { keep: [], leftOut: [], ownerHeld: [] };
  for (const [kind, entry] of Object.entries(register)) {
    if (!entry || !Array.isArray(entry.layers) || typeof entry.recovery !== "string") {
      throw new RecoveryError("INVALID_RECOVERY_REGISTER", `invalid recovery entry: ${kind}`);
    }
    if (entry.recovery === "keep") {
      selection.keep.push({ kind, entry });
      continue;
    }
    if (entry.recovery === "owner-held") {
      selection.ownerHeld.push(kind);
      continue;
    }
    const reason = EXCLUSION_REASONS[entry.recovery as keyof typeof EXCLUSION_REASONS];
    if (!reason) {
      throw new RecoveryError("INVALID_RECOVERY_REGISTER", `unknown recovery policy for ${kind}: ${entry.recovery}`);
    }
    selection.leftOut.push({ kind, recovery: entry.recovery, reason });
  }
  return selection;
}

function failure(kind: string, layer: number, reason: string) {
  return { kind, layer, reason };
}

function gitBaseForSelection(selection: RecoverySelection): RecoveryGitBase[] {
  return selection.keep.flatMap(({ kind, entry }) => entry.layers
    .map((layer, layerIndex) => ({ kind, layer: layerIndex, kindOfLayer: layerKind(layer) }))
    .filter((item) => item.kindOfLayer === "git")
    .map(({ kind, layer }) => ({ kind, layer })));
}

/** Export every non-git layer of every selected entry. */
export async function exportRecovery({
  register,
  facilities = {},
}: {
  register: RecoveryRegister;
  facilities: RecoveryFacilities;
}): Promise<RecoveryDocument> {
  const selection = selectRecovery(register);
  const entries: RecoveryDocument["entries"] = {};
  const failures: Array<{ kind: string; layer: number; reason: string }> = [];

  for (const { kind, entry } of selection.keep) {
    const records: RecoveryLayerRecords[] = [];
    for (const [layerIndex, layer] of entry.layers.entries()) {
      const kindOfLayer = layerKind(layer);
      if (kindOfLayer === "git") continue;
      const facility = kindOfLayer === null ? undefined : facilities[kindOfLayer];
      if (!facility) {
        failures.push(failure(kind, layerIndex, kindOfLayer
          ? `no facility for ${kindOfLayer} layer`
          : "layer has no recognised facility kind"));
        continue;
      }
      try {
        const value = await facility.export({ kind, entry, layer, layerIndex });
        records.push({
          layer: layerIndex,
          records: validateLayerRecords(layer, value, `${kind}[${layerIndex}]`),
        });
      } catch (error) {
        failures.push(failure(kind, layerIndex, error instanceof Error ? error.message : String(error)));
      }
    }
    entries[kind] = { records };
  }

  if (failures.length > 0) {
    throw new RecoveryError(
      "RECOVERY_EXPORT_FAILED",
      `could not export ${failures.length} declared recovery layer${failures.length === 1 ? "" : "s"}`,
      { failures },
    );
  }

  return {
    format: RECOVERY_FORMAT,
    version: RECOVERY_FORMAT_VERSION,
    entries,
    gitBase: gitBaseForSelection(selection),
    leftOut: selection.leftOut,
    ownerHeld: selection.ownerHeld,
  };
}

function assertDocumentShape(document: unknown): asserts document is RecoveryDocument {
  if (!document || typeof document !== "object") {
    throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", "recovery document must be an object");
  }
  const value = document as Record<string, unknown>;
  if (value.format !== RECOVERY_FORMAT) {
    throw new RecoveryError("UNKNOWN_RECOVERY_FORMAT", `unsupported recovery format: ${String(value.format)}`);
  }
  if (value.version !== RECOVERY_FORMAT_VERSION) {
    throw new RecoveryError("UNKNOWN_RECOVERY_VERSION", `unsupported recovery format version: ${String(value.version)}`);
  }
  if (!value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) {
    throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", "recovery entries must be an object");
  }
  if (!Array.isArray(value.gitBase) || !Array.isArray(value.leftOut) || !Array.isArray(value.ownerHeld)) {
    throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", "recovery exclusions or git base are malformed");
  }
  if (
    value.gitBase.some((item) => !item || typeof item !== "object"
      || typeof (item as Record<string, unknown>).kind !== "string"
      || !Number.isInteger((item as Record<string, unknown>).layer)
      || ((item as Record<string, unknown>).layer as number) < 0)
    || value.leftOut.some((item) => !item || typeof item !== "object"
      || typeof (item as Record<string, unknown>).kind !== "string"
      || typeof (item as Record<string, unknown>).recovery !== "string"
      || typeof (item as Record<string, unknown>).reason !== "string")
    || value.ownerHeld.some((kind) => typeof kind !== "string")
  ) {
    throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", "recovery exclusions or git base are malformed");
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameKinds(left: string[], right: string[]): boolean {
  return sameJson([...left].sort(), [...right].sort());
}

function leftOutSummary(items: Array<{ kind: string; recovery: string; reason: string }>) {
  return items
    .map(({ kind, recovery, reason }) => ({ kind, recovery, reason }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

function gitBaseSummary(items: RecoveryGitBase[]) {
  return items
    .map(({ kind, layer }) => ({ kind, layer }))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.layer - right.layer);
}

/**
 * Validate the complete document and facility coverage before the first write.
 * Individual facilities still own their own transaction boundary; independent
 * facilities cannot provide one transaction across their stores.
 */
export async function importRecovery({
  document,
  register,
  facilities = {},
}: {
  document: unknown;
  register: RecoveryRegister;
  facilities: RecoveryFacilities;
}): Promise<{ imported: string[] }> {
  assertDocumentShape(document);
  const selection = selectRecovery(register);
  const expectedKinds = selection.keep.map(({ kind }) => kind);
  const actualKinds = Object.keys(document.entries);
  if (!sameKinds(actualKinds, expectedKinds)) {
    throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", "recovery entries do not match the register selection");
  }
  if (
    !sameJson(leftOutSummary(document.leftOut), leftOutSummary(selection.leftOut))
    || !sameJson([...document.ownerHeld].sort(), [...selection.ownerHeld].sort())
    || !sameJson(gitBaseSummary(document.gitBase), gitBaseSummary(gitBaseForSelection(selection)))
  ) {
    throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", "recovery exclusions or git base do not match the register");
  }

  const work: Array<{ request: RecoveryImportRequest; facility: RecoveryFacility }> = [];
  const failures: Array<{ kind: string; layer: number; reason: string }> = [];
  for (const { kind, entry } of selection.keep) {
    const supplied = document.entries[kind];
    if (!supplied || !Array.isArray(supplied.records)) {
      throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", `records are missing for ${kind}`);
    }
    const expectedLayers = entry.layers
      .map((layer, layerIndex) => ({ layer, layerIndex, kindOfLayer: layerKind(layer) }))
      .filter((item) => item.kindOfLayer !== "git");
    if (supplied.records.length !== expectedLayers.length) {
      throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", `records do not cover every non-git layer for ${kind}`);
    }
    const expectedIndexes = new Set(expectedLayers.map(({ layerIndex }) => layerIndex));
    const seen = new Set<number>();
    for (const item of supplied.records) {
      if (!item || !Number.isInteger(item.layer) || !expectedIndexes.has(item.layer) || seen.has(item.layer)) {
        throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", `invalid layer records for ${kind}`);
      }
      seen.add(item.layer);
      const layer = entry.layers[item.layer];
      const kindOfLayer = layerKind(layer);
      const facility = kindOfLayer === null ? undefined : facilities[kindOfLayer];
      if (!facility) {
        failures.push(failure(kind, item.layer, kindOfLayer
          ? `no facility for ${kindOfLayer} layer`
          : "layer has no recognised facility kind"));
        continue;
      }
      const records = validateLayerRecords(layer, item.records, `${kind}[${item.layer}]`);
      work.push({
        request: { kind, entry, layer, layerIndex: item.layer, records },
        facility,
      });
    }
    if (seen.size !== expectedLayers.length) {
      throw new RecoveryError("INVALID_RECOVERY_DOCUMENT", `records do not cover every non-git layer for ${kind}`);
    }
  }
  if (failures.length > 0) {
    throw new RecoveryError("RECOVERY_IMPORT_FAILED", "no facility can import every declared recovery layer", { failures });
  }

  const imported: string[] = [];
  try {
    for (const { request, facility } of work) {
      const kind = request.kind;
      const layer = request.layerIndex;
      await facility.import({ ...request, records: cloneJson(request.records, `${kind}[${layer}]`) });
      if (!imported.includes(kind)) imported.push(kind);
    }
  } catch (error) {
    throw new RecoveryError(
      "RECOVERY_IMPORT_FAILED",
      error instanceof Error ? error.message : String(error),
      { imported },
    );
  }
  return { imported };
}

/** A host-free reference facility used by the contract tests and examples. */
export class InMemoryRecoveryFacility implements RecoveryFacility {
  #records = new Map<string, unknown>();

  #key(kind: string, layerIndex: number) {
    return `${kind}\u0000${layerIndex}`;
  }

  constructor(initial: Record<string, unknown> = {}) {
    for (const [kind, records] of Object.entries(initial)) {
      this.#records.set(this.#key(kind, 0), cloneJson(records, `${kind}`));
    }
  }

  export({ kind, layer, layerIndex }: RecoveryExportRequest): unknown {
    const stored = this.#records.get(this.#key(kind, layerIndex)) ?? [];
    if (layerKind(layer) !== "sql") return cloneJson(stored, `${kind}`);
    const columnsMap = layer.columns;
    if (!isObjectRecord(columnsMap)) {
      throw new RecoveryError("INVALID_RECOVERY_REGISTER", `${kind}[${layerIndex}] has no SQL columns map`);
    }
    if (!Array.isArray(stored)) {
      throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${kind}[${layerIndex}] does not contain SQL rows`);
    }
    const logicalRows = stored.map((row, rowIndex) => {
      if (!isObjectRecord(row)) {
        throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${kind}[${layerIndex}][${rowIndex}] is not a physical SQL row`);
      }
      const logical = Object.fromEntries(Object.entries(columnsMap).map(([logicalName, physicalName]) => {
        if (typeof physicalName !== "string" || !Object.hasOwn(row, physicalName)) {
          throw new RecoveryError("INVALID_RECOVERY_RECORDS", `${kind}[${layerIndex}][${rowIndex}] is missing physical column ${String(physicalName)}`);
        }
        return [logicalName, row[physicalName]];
      }));
      return logical;
    });
    return validateLayerRecords(layer, logicalRows, `${kind}[${layerIndex}]`);
  }

  import({ kind, layer, layerIndex, records }: RecoveryImportRequest): void {
    const portable = validateLayerRecords(layer, records, `${kind}[${layerIndex}]`);
    if (layerKind(layer) === "sql") {
      const columnsMap = layer.columns;
      if (!isObjectRecord(columnsMap)) {
        throw new RecoveryError("INVALID_RECOVERY_REGISTER", `${kind}[${layerIndex}] has no SQL columns map`);
      }
      const physicalRows = (portable as unknown[]).map((row) => Object.fromEntries(
        Object.entries(columnsMap).map(([logicalName, physicalName]) => [physicalName, (row as Record<string, unknown>)[logicalName]]),
      ));
      this.#records.set(this.#key(kind, layerIndex), cloneJson(physicalRows, `${kind}[${layerIndex}]`));
      return;
    }
    this.#records.set(this.#key(kind, layerIndex), portable);
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries([...this.#records].map(([key, records]) => [key, cloneJson(records, key)]));
  }
}
