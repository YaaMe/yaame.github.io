import { getCollection, render } from "virtual:astro";

export function readPosts() {
  return getCollection("posts");
}

export function readKomorebi() {
  return getCollection("komorebi");
}

export type Post = Awaited<ReturnType<typeof readPosts>>[number];
export type Chapter = Awaited<ReturnType<typeof readKomorebi>>[number];

export function renderContent(entry: Post | Chapter) {
  return render(entry);
}
