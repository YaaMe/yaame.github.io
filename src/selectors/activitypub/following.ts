import { record } from "../../persistence/records/following.ts";

export const readFollowing = async (): Promise<string[]> => (await record.get()) ?? [];
