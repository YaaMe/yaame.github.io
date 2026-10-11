import { z } from "zod";

export const ORIGINS = ["owner", "others", "system"] as const;
export const RECOVERIES = ["keep", "owner-held", "rebuild", "reset", "ephemeral", "none"] as const;
export const PURPOSES = ["content", "identity", "federation", "auth", "bookkeeping", "deployment"] as const;
export const WRITE_BACK_NAMES = ["promote", "tombstone"] as const;
export const LIST_NAMES = ["never"] as const;
export const COMMENT_COLUMN_NAMES = [
  "activityId", "objectId", "rootId", "replyToId", "actorId",
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
const refLayer = z.object({ ref: z.string(), fields: z.array(z.string()) }).strict();

const layer = z.union([gitLayer, sqlLayerSchema, recordsLayer, memoryLayer, refLayer]);

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
      const patterned = /\{[A-Za-z][A-Za-z0-9_]*\}/.test(candidate.records);
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

  const comments = config.comments;
  if (!comments) return;

  const sqlIndex = comments.layers.findIndex((candidate) => "sql" in candidate);
  if (sqlIndex < 0) {
    context.addIssue({
      code: "custom",
      path: ["comments", "layers"],
      message: "comments must declare an sql layer",
    });
    return;
  }

  const sql = comments.layers[sqlIndex];
  if (!("sql" in sql)) return;
  for (const name of COMMENT_COLUMN_NAMES) {
    if (!(name in sql.columns)) {
      context.addIssue({
        code: "custom",
        path: ["comments", "layers", sqlIndex, "columns", name],
        message: "required comments column",
      });
    }
  }
});
export type DataEntry = z.infer<typeof dataEntrySchema>;
export type DataConfig = z.infer<typeof dataConfigSchema>;
type Layer = DataEntry["layers"][number];
export type GitLayer = Extract<Layer, { git: string }>;
export type SqlLayer = Extract<Layer, { sql: string }>;

