export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const randomToken = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));
