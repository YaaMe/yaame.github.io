export const SESSION_COOKIE = "session";
export const STATE_COOKIE = "oauth_state";
export const VERIFIER_COOKIE = "oauth_verifier";

export function encodeState(state: string, from: string): string {
  // A UUID holds no dot, so the first one is the seam.
  return `${state}.${encodeURIComponent(from)}`;
}

export function decodeState(carried: string | null) {
  // The cookie carries the state and the page to return to, in that order.
  const seam = carried ? carried.indexOf(".") : -1;
  const expected = seam < 0 ? carried : carried!.slice(0, seam);
  let from = "/";
  if (seam >= 0) {
    // One decode, undoing the one encode. What comes out is still a
    // percent-encoded path, which is what `safeReturn` wants.
    try {
      from = decodeURIComponent(carried!.slice(seam + 1));
    } catch {
      from = "/";
    }
  }
  return { expected, from };
}
