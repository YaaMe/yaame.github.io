import type { RequestContext } from "@fedify/fedify";
import type { Person } from "@fedify/fedify/vocab";
import { record } from "../../persistence/records/actor-digest.ts";
import { sendActorUpdate } from "../../gateways/activitypub/outbound.ts";

/**
 * Tell the followers when the actor changes, at the moment it changes.
 *
 * Nothing re-reads an actor because we edited it. Mastodon refreshes remote
 * accounts lazily, on the order of a day, and what it stored at first fetch
 * keeps deciding the avatar it shows and whether the follower list is hidden.
 *
 * The document is fingerprinted, so an Update goes out when it moves and never
 * otherwise: without that, every deploy pushes a message to every follower's
 * server for builds that changed nothing here.
 *
 * See docs/decisions/0003-the-actor-announces-itself-when-it-is-built.md.
 */
export async function announceIfChanged(ctx: RequestContext<void>, person: Person): Promise<void> {
  const document = JSON.stringify(await person.toJsonLd({ format: "compact" }));
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document))),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if ((await record.get()) === digest) return;

  // Written before sending: a failed delivery is not retried, which is the
  // trade against announcing on every fetch until one succeeds.
  await record.put(digest);
  await sendActorUpdate(ctx, person, digest);
}
