import { AUTH } from "../../config/auth.ts";
import { sessions } from "../../config/data.config.generated.mjs";
import type { Session } from "../../models/records/sessions.ts";
import { recordAt } from "./record.ts";

export function sessionRecord(id: string) {
  const record = recordAt<Session>(sessions.key(id));
  return {
    ...record,
    put: (value: Session) => record.put(value, { ttl: AUTH.sessionDays * 86400 }),
  };
}
