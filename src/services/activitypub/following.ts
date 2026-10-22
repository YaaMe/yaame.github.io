import type { Context } from "@fedify/fedify";
import { isActor } from "@fedify/fedify/vocab";
import { followIntent } from "../../config/data.config.generated.mjs";
import { record as ledger } from "../../persistence/records/follow-ledger.ts";
import { record as following } from "../../persistence/records/following.ts";
import { readFollowing } from "../../selectors/activitypub/following.ts";
import { lookupObject } from "../../gateways/activitypub/resolve.ts";
import { sendFollow, sendUnfollow } from "../../gateways/activitypub/outbound.ts";

const intent = followIntent as { follow: string[] };

export async function updateFollowing(actorId: string, accepted: boolean): Promise<void> {
  const list = await readFollowing();
  if (accepted) {
    if (list.includes(actorId)) return;
    await following.put([actorId, ...list]);
  } else {
    await following.put(list.filter((href) => href !== actorId));
  }
}

export async function acceptFollowing(actorId: string): Promise<void> {
  // A late Accept must not revive an unfollow after its intent was dropped:
  // reconciliation no longer has a sent Follow to undo.
  const sent = (await ledger.get()) ?? {};
  if (!Object.values(sent).includes(actorId)) return;
  await updateFollowing(actorId, true);
}

/**
 * Make the followed set match the intent written in git.
 *
 * The comparison is against the follow-intent record of what we have sent, not
 * against the following record:
 *
 *   intended, sent       → nothing
 *   intended, not sent   → send Follow
 *   not intended, sent   → send Undo, and drop from following
 *   not intended, unsent → nothing
 *
 * See docs/decisions/0004-follow-reconciliation-pivots-on-what-was-sent.md.
 *
 * That same table holds each handle's resolved actor, so an intent deleted from
 * git still says who the Undo goes to.
 *
 * This half cannot run in CI: sending a Follow needs the signing key, which
 * exists only in the Worker's environment. The half that writes git — comment
 * tombstones, comment promotion — cannot run here, for the mirror reason.
 */
export async function reconcileFollowing(ctx: Context<void>): Promise<void> {
  const wanted = new Set(intent.follow);
  // Annotated, not inferred: `Record | null` with `?? {}` is a union of two
  // types, and `Object.entries` resolves no overload against a union.
  const resolved: Record<string, string> =
    (await ledger.get()) ?? {};
  let changed = false;

  for (const handle of wanted) {
    if (resolved[handle]) continue;
    const found = await lookupObject(ctx, handle);
    // Unresolvable: retried on the next pass. A temporarily unreachable host
    // and a mistyped handle are indistinguishable from here.
    if (found === null || !isActor(found) || found.id === null) continue;
    const actor = found;
    // Held separately: narrowing on `found.id` does not follow a new binding.
    const actorId = found.id;
    resolved[handle] = actorId.href;
    changed = true;
    await sendFollow(ctx, actor, actorId, handle);
  }

  for (const [handle, actorId] of Object.entries(resolved)) {
    if (wanted.has(handle)) continue;
    delete resolved[handle];
    changed = true;
    const found = await lookupObject(ctx, actorId);
    if (found !== null && isActor(found) && found.id !== null) {
      const actor = found;
      const target = found.id;
      await sendUnfollow(ctx, actor, target, handle);
    }
    // Dropped without waiting for a reply: an Undo has no Accept, so sending it
    // is the whole of the change on our side.
    await updateFollowing(actorId, false);
  }

  if (changed) await ledger.put(resolved);
}
