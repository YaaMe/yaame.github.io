import { z } from "zod";
import { failureId } from "./key-scheme.ts";

export const failureReason = z.enum(["delivery-exhausted", "never-ready"]);
export type FailureReason = z.infer<typeof failureReason>;

/**
 * The URL with credentials, query and fragment removed, or null when it is not
 * an http(s) URL. A query or userinfo can carry a token, and a failure row must
 * stay safe to read and copy.
 */
export function publicDeliveryUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = url.password = url.search = url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

const publicUrl = z.string().refine((value) => publicDeliveryUrl(value) === value).nullable();

/** A delivery failure's `data`. Strict, so error text cannot reach the row. */
export const deliveryFailureSchema = z.object({
  version: z.literal(1),
  inbox: publicUrl,
  activityId: publicUrl,
  attempt: z.number().int().positive(),
  reason: failureReason,
}).strict();
export type DeliveryFailure = z.infer<typeof deliveryFailureSchema>;

/**
 * Each kind's `data` schema, and the subject a row of that kind is unique by.
 * A new kind is added here; the table does not change.
 */
const KINDS = {
  delivery: {
    data: deliveryFailureSchema,
    subject: (data: DeliveryFailure) => data.inbox ?? "(unknown)",
  },
} as const;
export type FailureKind = keyof typeof KINDS;
const failureKind = z.enum(Object.keys(KINDS) as [FailureKind, ...FailureKind[]]);

/**
 * A row as the table holds it, with `data` parsed. Checked before every write
 * and after every read, so the JSON column never holds a shape its kind does
 * not define.
 *
 * `at` is fixed-width UTC with milliseconds, as `toISOString` writes it: the
 * upsert compares it as text.
 */
export const storedFailureSchema = z.object({
  id: z.uuid(),
  kind: failureKind,
  subject: z.string().min(1),
  at: z.iso.datetime({ precision: 3 }),
  data: z.record(z.string(), z.unknown()),
}).strict().superRefine((row, context) => {
  const kind = KINDS[row.kind];
  const data = kind.data.safeParse(row.data);
  if (!data.success) {
    context.addIssue({ code: "custom", path: ["data"], message: `invalid ${row.kind} failure data` });
    return;
  }
  if (row.subject !== kind.subject(data.data)) {
    context.addIssue({ code: "custom", path: ["subject"], message: "the subject does not follow from the data" });
  }
  if (row.id !== failureId(row.kind, row.subject)) {
    context.addIssue({ code: "custom", path: ["id"], message: "the id does not follow from the kind and subject" });
  }
});
export type StoredFailure = z.infer<typeof storedFailureSchema>;

export function parseStoredFailure(value: unknown): StoredFailure {
  const parsed = storedFailureSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid failure row");
  return parsed.data;
}

export function deliveryFailureRow({ inbox, activityId, attempt, reason, at }: {
  inbox: unknown;
  activityId: unknown;
  attempt: number;
  reason: FailureReason;
  at: Date;
}): StoredFailure {
  const data: DeliveryFailure = {
    version: 1, inbox: publicDeliveryUrl(inbox), activityId: publicDeliveryUrl(activityId), attempt, reason,
  };
  const subject = KINDS.delivery.subject(data);
  const parsed = storedFailureSchema.safeParse({
    id: failureId("delivery", subject), kind: "delivery", subject, at: at.toISOString(), data,
  });
  if (!parsed.success) throw new Error("invalid delivery failure");
  return parsed.data;
}
