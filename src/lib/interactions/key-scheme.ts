import { sha1 } from "@noble/hashes/legacy";

export const NAMESPACE = "f3881559-97e2-41ff-88e1-f33f0862c162";
export const SOURCES = Object.freeze({ activitypub: "activitypub", github: "github" } as const);
export type Source = typeof SOURCES[keyof typeof SOURCES];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const namespaceBytes = Uint8Array.from(NAMESPACE.replaceAll("-", "").match(/../g)!, (hex) => parseInt(hex, 16));

export function normalizedUrl(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("identity and federated URLs must use HTTP(S)");
  return url.href;
}

export function normalizedIdentifier(source: Source, identifier: string): string {
  if (source === SOURCES.activitypub) return normalizedUrl(identifier);
  if (source !== SOURCES.github || !/^\d+$/.test(identifier) || BigInt(identifier) <= 0n) {
    throw new Error("GitHub identities require a positive numeric user id");
  }
  return BigInt(identifier).toString();
}

function v5(fields: string[]): string {
  const input = new TextEncoder().encode(JSON.stringify(fields));
  const bytes = sha1(new Uint8Array([...namespaceBytes, ...input])).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function identityId(source: Source, identifier: string): string {
  return v5([source, normalizedIdentifier(source, identifier)]);
}

export function commentId(input: {
  source: Source;
  identifier: string;
  objectId?: string | null;
  submissionId?: string | null;
}): string {
  const identifier = normalizedIdentifier(input.source, input.identifier);
  let object: string;
  if (input.source === SOURCES.activitypub) {
    if (!input.objectId) throw new Error("a federated comment requires its objectId");
    object = normalizedUrl(input.objectId);
  } else {
    if (!input.submissionId || !UUID.test(input.submissionId)) throw new Error("a GitHub comment requires its form UUID");
    object = input.submissionId.toLowerCase();
  }
  return v5([input.source, identifier, object]);
}

export function sameOrigin(identifier: string, ...attributes: string[]): boolean {
  try {
    const origin = new URL(normalizedUrl(identifier)).origin;
    return attributes.every((attribute) => new URL(normalizedUrl(attribute)).origin === origin);
  } catch {
    return false;
  }
}
