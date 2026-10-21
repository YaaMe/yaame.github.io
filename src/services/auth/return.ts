/**
 * A path on this site, or "/".
 *
 * Whatever comes back from the round trip ends up in a `Location` header, so
 * this is the difference between returning someone to their page and handing
 * an open redirect to anyone who can compose a link. Refused: anything not
 * starting with "/", anything starting with "//" or "/\\" (URL parsers read
 * the rest as a host, which is the redirect off-site), control characters
 * (header injection), and /auth itself, which would restart the login it
 * just finished.
 */
export function safeReturn(path: string | null | undefined): string {
  if (!path) return "/";

  // Checked twice: as written, and as a browser reads it after one decode.
  // An encoded "//" is the same off-site redirect spelled differently, and
  // checking only one of the two forms lets the other through.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "/";
  }
  for (const form of [path, decoded]) {
    if (!form.startsWith("/")) return "/";
    if (form.startsWith("//") || form.startsWith("/\\")) return "/";
    if (/[\u0000-\u001f\u007f]/.test(form)) return "/";
    if (form === "/auth" || form.startsWith("/auth/")) return "/";
  }

  // As written. Returning the decoded form would rename the target: %2F is a
  // character in a segment, and "/" is a segment boundary.
  return path;
}

