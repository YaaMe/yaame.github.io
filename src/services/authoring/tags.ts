export type TagMode = "interactive" | "dedicated";

export function readTags(source: string) {
  return [...source.matchAll(/^\s{2}(\w+):\s*"([^"]+)"/gm)]
    .map((match) => ({ slug: match[1], label: match[2] }));
}

// The commands have different acceptance rules until B6, including duplicates.
export function validTagInput(slug: string, label: string, mode: TagMode) {
  return Boolean(label) && (mode === "interactive" ? /^\w+$/ : /^[a-z][a-z0-9_]*$/).test(slug);
}

export function prepareTagAddition(source: string, slug: string, label: string, mode: TagMode) {
  if (!validTagInput(slug, label, mode)) return { status: "invalid" as const };
  if (mode === "dedicated" && new RegExp(`^\\s{2}${slug}:`, "m").test(source)) {
    return { status: "duplicate" as const };
  }
  return {
    status: "write" as const,
    document: source.replace(/\n\} as const;/, `\n  ${slug}: "${label}",\n} as const;`),
  };
}

export function tagUsage(documents: string[], pool: ReturnType<typeof readTags>) {
  const used = new Map<string, number>();
  for (const document of documents) {
    const fm = document.split("---")[1] ?? "";
    // Items under `tags:` only: list items beneath any other field would
    // otherwise be counted as tags.
    const block = fm.match(/^tags:\s*\n((?:\s+-\s*\w+\s*\n)+)/m);
    if (!block) continue;
    for (const match of block[1].matchAll(/-\s*(\w+)/g)) {
      used.set(match[1], (used.get(match[1]) ?? 0) + 1);
    }
  }
  const orphan = [...used.keys()].filter((slug) => !pool.some((tag) => tag.slug === slug));
  return { used, orphan };
}
