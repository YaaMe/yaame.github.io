import { getCollection } from "virtual:astro";

export function readComments() {
  return getCollection("comments");
}

export type Comment = Awaited<ReturnType<typeof readComments>>[number]["data"]["comments"][number];
