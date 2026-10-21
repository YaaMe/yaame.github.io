import { z } from "zod";
import { base, stamped } from "./fields.ts";

export const postCollectionSchema = z.object({ ...base, date: stamped });
