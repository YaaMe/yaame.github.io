export function validFollowHandle(handle: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(handle);
}

export function prepareFollowIntent(source: string, handle: string, remove: boolean) {
  const doc = JSON.parse(source);
  const had = doc.follow.includes(handle);
  if (remove) {
    if (!had) return { status: "absent" as const };
    doc.follow = doc.follow.filter((h: string) => h !== handle);
  } else {
    if (had) return { status: "present" as const };
    doc.follow.push(handle);
    doc.follow.sort();
  }
  return { status: "write" as const, document: `${JSON.stringify(doc, null, 2)}\n` };
}
