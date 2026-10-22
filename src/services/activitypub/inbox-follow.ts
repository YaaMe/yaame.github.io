/**
 * Signature-free inbox seam. Fedify verifies signatures and sender identity
 * before its listeners call these normalized handlers; tests can therefore
 * exercise the state changes without network fetches or cryptographic keys.
 */
/** A follower, as much of it as delivery needs, with the Follow that asked. */
export type Follower = { actorUrl: string; inbox: string; sharedInbox: string | null; followId: string | null };

export type FollowActivity = {
  id: string | null;
  actorId: string | null;
  objectId: string | null;
};

export type FollowAccept = {
  id: string | null;
  actorId: string | null;
  objectId: string;
};

/**
 * Each call changes only the row its actor names, so two deliveries handled
 * together cannot undo each other.
 */
export type FollowerStore = {
  add(follower: Follower): Promise<boolean>;
  remove(actorUrl: string): Promise<boolean>;
  departure?(actorUrl: string): Promise<void>;
};

export async function handleFollow(
  activity: FollowActivity,
  follower: Follower | null,
  ownActorId: string,
  store: FollowerStore,
  sendAccept: (accept: FollowAccept) => Promise<void>,
): Promise<boolean> {
  if (activity.objectId !== ownActorId || follower === null) return false;
  // Refreshed rather than skipped when already present: a repeat Follow is
  // how a moved inbox reaches us.
  if (!(await store.add(follower))) return false;
  await sendAccept({ id: activity.id, actorId: activity.actorId, objectId: ownActorId });
  return true;
}

export async function handleUndoFollow(
  actorId: string,
  _followActorId: string | null,
  store: FollowerStore,
): Promise<boolean> {
  const removed = await store.remove(actorId);
  if (removed) await store.departure?.(actorId);
  return removed;
}

export async function handleCommentDelete(
  objectId: string,
  actorId: string,
  remove: (objectId: string, actorId: string) => Promise<boolean>,
): Promise<boolean> {
  return remove(objectId, actorId);
}
