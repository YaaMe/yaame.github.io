import { commentHref } from "../../models/content/comments.ts";

export async function actorName(actorId: string) {
  const href = commentHref.safeParse(actorId);
  if (!href.success) return undefined;
  try {
    const response = await fetch(href.data, {
      redirect: "error",
      headers: { accept: "application/activity+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const actor = await response.json() as { name?: unknown; preferredUsername?: unknown };
    const name = typeof actor.name === "string" && actor.name.trim()
      ? actor.name.trim()
      : actor.preferredUsername;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

