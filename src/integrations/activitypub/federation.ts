import { installShared } from "../../routes/activitypub/shared.ts";
installShared();

export { federation } from "../../services/activitypub/runtime.ts";
export { dropFollowersAt } from "../../services/activitypub/followers.ts";
