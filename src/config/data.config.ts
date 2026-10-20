import { z } from "zod";
import { isRecordKeyPattern } from "../lib/key-pattern.ts";

export const ORIGINS = ["owner", "others", "system"] as const;
export const RECOVERIES = ["keep", "owner-held", "rebuild", "reset", "ephemeral", "none"] as const;
export const PURPOSES = ["content", "identity", "federation", "auth", "bookkeeping", "deployment"] as const;
export const WRITE_BACK_NAMES = ["promote", "tombstone"] as const;
export const LIST_NAMES = ["never"] as const;
export const COMMENT_COLUMN_NAMES = [
  "id", "source", "identifier", "authorId", "activityId", "objectId",
  "submissionId", "inReplyTo", "root", "replyTo",
  "content", "published", "receivedAt", "deletedAt", "promotedAt",
] as const;

const gitLayer = z.object({ git: z.string(), format: z.string() }).strict();
const sqlLayerSchema = z.object({
  sql: z.string(),
  columns: z.record(z.string(), z.string()),
}).strict();
const recordsLayer = z.object({
  records: z.union([z.string().min(1), z.literal(true)]),
  format: z.string().min(1),
}).strict();
const memoryLayer = z.object({ memory: z.string().min(1) }).strict();
// Items that live outside the portable register stores are named by their
// entry key. The marker keeps them in the same entry shape without offering a
// field where a secret or account value could be written.
const externalLayer = z.object({ external: z.literal(true) }).strict();
const refLayer = z.object({ ref: z.string(), fields: z.array(z.string()) }).strict();

const layer = z.union([gitLayer, sqlLayerSchema, recordsLayer, memoryLayer, externalLayer, refLayer]);

export const dataEntrySchema = z.object({
  layers: z.array(layer).min(1),
  writeBack: z.array(z.enum(WRITE_BACK_NAMES)),
  list: z.enum(LIST_NAMES).optional(),
  origin: z.enum(ORIGINS),
  recovery: z.enum(RECOVERIES),
  purposes: z.array(z.enum(PURPOSES)).min(1),
  description: z.string(),
}).strict();

export const dataConfigSchema = z.record(z.string(), dataEntrySchema).superRefine((config, context) => {
  for (const [kind, entry] of Object.entries(config)) {
    const external = entry.layers.some((candidate) => "external" in candidate);
    if (entry.recovery === "owner-held" && !external) {
      context.addIssue({
        code: "custom",
        path: [kind, "layers"],
        message: "owner-held entries must be named without a value-bearing layer",
      });
    }
    if (external && entry.layers.some((candidate) => !("external" in candidate))) {
      context.addIssue({
        code: "custom",
        path: [kind, "layers"],
        message: "an external entry cannot be combined with a value-bearing layer",
      });
    }
    for (const [index, candidate] of entry.layers.entries()) {
      if (!('records' in candidate)) continue;
      if (candidate.records === true) {
        if (entry.list !== "never") {
          context.addIssue({
            code: "custom",
            path: [kind, "list"],
            message: "a record store without an application key must declare list: never",
          });
        }
        continue;
      }
      const patterned = isRecordKeyPattern(candidate.records);
      if (patterned && entry.list === undefined) {
        context.addIssue({
          code: "custom",
          path: [kind, "list"],
          message: "a record key pattern must declare list",
        });
      }
      if (
        candidate.records.includes("{") !== patterned ||
        (candidate.records.match(/\{/g)?.length ?? 0) !== (candidate.records.match(/\}/g)?.length ?? 0)
      ) {
        context.addIssue({
          code: "custom",
          path: [kind, "layers", index, "records"],
          message: "record key pattern must use named placeholders",
        });
      }
    }
  }

  for (const [kind, columns] of [
    ["comments", COMMENT_COLUMN_NAMES],
    ["visitor-identities", ["id", "source", "identifier", "name"]],
  ] as const) {
    const entry = config[kind];
    if (!entry) continue;
    const sqlIndex = entry.layers.findIndex((candidate) => "sql" in candidate);
    if (sqlIndex < 0) {
      context.addIssue({
        code: "custom",
        path: [kind, "layers"],
        message: `${kind} must declare an sql layer`,
      });
      continue;
    }
    const sql = entry.layers[sqlIndex];
    if (!("sql" in sql)) continue;
    for (const name of columns) {
      if (!(name in sql.columns)) {
        context.addIssue({
          code: "custom",
          path: [kind, "layers", sqlIndex, "columns", name],
          message: `required ${kind} column`,
        });
      }
    }
  }
});
export type DataEntry = z.infer<typeof dataEntrySchema>;
export type DataConfig = z.infer<typeof dataConfigSchema>;
type Layer = DataEntry["layers"][number];
export type GitLayer = Extract<Layer, { git: string }>;
export type SqlLayer = Extract<Layer, { sql: string }>;

