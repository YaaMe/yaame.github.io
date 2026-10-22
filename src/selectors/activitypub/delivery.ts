import { enqueuedTargets } from "../../persistence/interactions/delivery-rows.ts";
import { store } from "../../persistence/interactions/database.ts";
import { CHANNELS } from "../../models/interactions/key-scheme.ts";

export const deliveredTargets = async () => enqueuedTargets(await store(), CHANNELS.activitypub);
