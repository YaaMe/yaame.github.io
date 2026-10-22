import { importJwk } from "@fedify/fedify";
import { platform } from "../../platform/index.ts";
import { AP } from "../../config/activitypub.ts";

export async function keyPairs(identifier: string) {
  if (identifier !== AP.user) return [];

  // RSA because the classic actor `publicKey` field requires it. Separate
  // from the OpenPGP identity, which is ed25519 and never leaves hardware.
  //
  // Read, never generated: an absent key fails every request rather than
  // minting a new identity, which would leave every follower holding a key
  // that no longer matches. See
  // docs/decisions/0005-the-signing-key-is-read-never-generated.md.
  const raw = platform.secret("AP_KEY_JWK");
  if (!raw) throw new Error("AP_KEY_JWK is not set");
  const { priv, pub } = JSON.parse(raw) as { priv: JsonWebKey; pub: JsonWebKey };
  return [{
    privateKey: await importJwk(priv, "private"),
    publicKey: await importJwk(pub, "public"),
  }];
}

export const actorKeys = (ctx: import("@fedify/fedify").RequestContext<void>, identifier: string) =>
  ctx.getActorKeyPairs(identifier);
