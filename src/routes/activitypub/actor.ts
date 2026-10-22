import { AP } from "../../config/activitypub.ts";

export const isLocalActor = (identifier: string): boolean => identifier === AP.user;
