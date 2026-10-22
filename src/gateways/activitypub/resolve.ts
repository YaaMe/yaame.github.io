import type { Context } from "@fedify/fedify";
import type { Activity } from "@fedify/fedify/vocab";

/** Reads an object only when it is embedded; a bare URL is not dereferenced. */
const EMBEDDED_ONLY = {
  documentLoader: async (): Promise<never> => {
    throw new Error("embedded objects only");
  },
  suppressError: true,
};

export const resolveObject = (activity: Activity) => activity.getObject();
export const embeddedObject = (activity: Activity) => activity.getObject(EMBEDDED_ONLY);
export const resolveActor = (activity: Activity) => activity.getActor();
export const lookupObject = (ctx: Context<void>, identifier: string) => ctx.lookupObject(identifier);
