import type { Context } from "@fedify/fedify";
import type { Note } from "@fedify/fedify/vocab";
import { deliveredTargets } from "../../selectors/activitypub/delivery.ts";
import { record } from "../../persistence/records/note-digests.ts";
import { sendNoteUpdate } from "../../gateways/activitypub/outbound.ts";

/**
 * Tell the followers when a post they already have has changed.
 *
 * Nothing re-reads a post because we edited it; a server that holds a copy goes
 * on showing what it fetched. So an edit in git is invisible to everyone who
 * received the original, forever.
 *
 * Fingerprinted on the content, deliberately not on the counts. A reply or a
 * like changes what the note serialises, and announcing those would push a
 * message to every follower's server for every heart — which is also not what
 * Mastodon does: counts travel when someone fetches, not when they change.
 *
 * Only posts that were actually delivered are announced. Editing something the
 * followers never received is not news to them.
 */
export async function announceEdits(ctx: Context<void>, notes: { target: string; note: Note }[]): Promise<void> {
  const delivered = await deliveredTargets();
  const digests = (await record.get()) ?? {};

  const changed: Note[] = [];
  for (const { target, note } of notes) {
    if (!note.id) continue;
    const body = JSON.stringify([note.content?.toString(), note.url?.toString(), note.published?.toString()]);
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (digests[note.id.href] === digest) continue;
    const first = digests[note.id.href] === undefined;
    digests[note.id.href] = digest;
    // A post seen for the first time has nothing to compare against, and one
    // never delivered has no audience holding a stale copy.
    if (!first && delivered.has(target)) changed.push(note);
  }

  if (Object.keys(digests).length > 0) await record.put(digests);

  for (const note of changed) await sendNoteUpdate(ctx, note);
}
