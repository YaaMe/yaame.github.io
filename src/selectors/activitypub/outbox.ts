import { AP } from "../../config/activitypub.ts";
import { allPosts, href, type Post } from "../posts.ts";
import { allNotes, noteHref, noteHtml, type Note as NoteEntry } from "../notes.ts";
import type { Item } from "../../models/activitypub/objects.ts";

/** `slice(0, undefined)` is the whole array, which is what 0 means here. */
const window = () => (AP.published === 0 ? undefined : AP.published);

const fromPost = (post: Post): Item => {
  const url = new URL(href(post), AP.blogUrl);
  return {
    slug: post.id,
    published: post.data.date.iso,
    content:
      `<p><strong>${post.data.title}</strong></p>` +
      (post.data.description ? `<p>${post.data.description}</p>` : "") +
      `<p><a href="${url}">${url}</a></p>`,
    url,
  };
};

const fromNote = (n: NoteEntry): Item => ({
  slug: n.id,
  published: n.published,
  content: noteHtml(n),
  url: new URL(noteHref(n), AP.blogUrl),
});

/** Newest first, which `OrderedCollection` requires (ActivityPub §5). */
export async function timeline(): Promise<Item[]> {
  const [posts, notes] = await Promise.all([allPosts(), allNotes()]);
  return [...posts.map(fromPost), ...notes.map(fromNote)].sort((a, b) =>
    b.published.localeCompare(a.published),
  );
}


export async function publishedItems(): Promise<Item[]> {
  return (await timeline()).slice(0, window());
}

export async function pinnedItems(): Promise<Item[]> {
  return (await allPosts()).filter((p) => p.data.pinned).map(fromPost);
}

export async function pinnedCount(): Promise<number> {
  return (await pinnedItems()).length;
}
