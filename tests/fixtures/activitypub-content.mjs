export const collections = { posts: [], notes: [] };
export const reads = [];

export async function getCollection(name) {
  reads.push(name);
  if (!(name in collections)) throw new Error(`unexpected collection: ${name}`);
  return collections[name];
}

export async function render() {
  throw new Error("ActivityPub does not render collection entries");
}
