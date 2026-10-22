export async function isPublished(address: URL, request: typeof fetch): Promise<boolean> {
  return (await request(address.href, { headers: { accept: "application/activity+json" } })).status === 200;
}
