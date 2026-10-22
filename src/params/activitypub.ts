import { Follow, Note, type Activity, type Actor, type Create, type Object as ASObject } from "@fedify/fedify/vocab";

export const followInput = (activity: Follow) => ({
  id: activity.id?.href ?? null,
  actorId: activity.actorId?.href ?? null,
  objectId: activity.objectId?.href ?? null,
});

export function followerInput(activity: Follow, actor: Actor | null) {
  // No inbox means even the Accept cannot be delivered.
  if (!actor?.id || !actor.inboxId) return null;
  return {
    recipient: actor,
    follower: {
      actorUrl: actor.id.href,
      inbox: actor.inboxId.href,
      sharedInbox: actor.endpoints?.sharedInbox?.href ?? null,
      followId: activity.id?.href ?? null,
    },
  };
}

export function commentInput(create: Create, object: ASObject | null) {
  // Only replies are retained; a mention alone must not turn this into a mailbox.
  if (!(object instanceof Note) || !create.id || !object.id || !object.replyTargetId) return null;
  const signingActor = create.actorId;
  if (!signingActor) return null;
  if (object.attributionIds.some((id) => id.href !== signingActor.href)) return null;
  return {
    activityId: create.id.href,
    objectId: object.id.href,
    inReplyTo: object.replyTargetId.href,
    actorId: signingActor.href,
    content: object.content?.toString() ?? "",
    // Date supplies the fallback without requiring a runtime Temporal global.
    published: object.published?.toString() ?? new Date().toISOString(),
  };
}

export function reactionInput(activity: Activity, kind: "Announce" | "Like") {
  if (!activity.id || !activity.actorId || !activity.objectId) return null;
  return { activityId: activity.id.href, objectId: activity.objectId.href, actorId: activity.actorId.href, kind };
}

export const isFollow = (object: ASObject | null): object is Follow => object instanceof Follow;

export const followReply = (object: ASObject | null) => isFollow(object) ? followInput(object) : null;
