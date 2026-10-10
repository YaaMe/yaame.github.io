/**
 * Signature-free inbox seam. Fedify verifies signatures and sender identity
 * before its listeners call these normalized handlers; tests can therefore
 * exercise the state changes without network fetches or cryptographic keys.
 */
/**
 * A follower, as much of it as delivery needs.
 *
 * The inbox is stored, not derived. `<actor>/inbox` is Mastodon's layout rather
 * than a rule, and deriving it posts to a 404 on anything that chose otherwise —
 * silently, because delivery is asynchronous and no one is waiting on the answer.
 */
export type Follower = { id: string; inbox: string; sharedInbox?: string };

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

export type FollowerStore = {
  read(): Promise<Follower[]>;
  write(followers: Follower[]): Promise<void>;
  departure?(id: string): Promise<void>;
};

export async function handleFollow(
  activity: FollowActivity,
  follower: Follower | null,
  ownActorId: string,
  store: FollowerStore,
  sendAccept: (accept: FollowAccept) => Promise<void>,
): Promise<boolean> {
  if (activity.objectId !== ownActorId || follower === null) return false;

  // Replaced rather than skipped when already present: a repeat Follow is how
  // a moved inbox reaches us.
  const list = await store.read();
  await store.write([follower, ...list.filter((entry) => entry.id !== follower.id)]);
  await sendAccept({ id: activity.id, actorId: activity.actorId, objectId: ownActorId });
  return true;
}

export async function handleUndoFollow(
  actorId: string,
  _followActorId: string | null,
  store: FollowerStore,
): Promise<boolean> {
  const list = await store.read();
  const found = list.some((entry) => entry.id === actorId);
  if (found) await store.departure?.(actorId);
  await store.write(list.filter((entry) => entry.id !== actorId));
  return found;
}

export async function handleCommentDelete(
  objectId: string,
  actorId: string,
  remove: (objectId: string, actorId: string) => Promise<boolean>,
): Promise<boolean> {
  return remove(objectId, actorId);
}
