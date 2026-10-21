import { z } from "zod";
import { base, stamped } from "./fields.ts";

export const komorebiCollectionSchema = z.object({ ...base, date: stamped.optional() });
