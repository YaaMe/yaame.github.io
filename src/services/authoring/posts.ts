import { parsePostFilename } from "../../models/content/post-filename.ts";
export { parsePostFilename };

export function lastMonth(now: Date) {
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Month and day are range-checked, not just shape-checked: the file is
// written before anything else would notice a month 99.
function kindOf(s: string) {
  const match = parsePostFilename(s).period;
  switch (match?.kind) {
    case "year":
      return match.day === undefined ? { kind: "year", tags: ["summaries", "year"] } : null;
    case "month":
      return match.validMonth ? { kind: "month", tags: ["summaries", "month"] } : null;
    case "day":
      return match.validDay ? { kind: "post", tags: [] } : null;
  }

  return null;
}

export function preparePost(spec: string | undefined, now: Date, title: string | null = null) {
  const period = spec ?? lastMonth(now);
  const kind = kindOf(period);
  return kind ? { spec: period, title: title ?? period, ...kind } : null;
}

// Published now. A summary's identity is the period in its filename, so this
// is metadata and nothing more.
export function postStamp(n: Date) {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ` +
    `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}+08:00`;
}

const FIELD = { desc: "description", tags: "tags" };

const MAX = 30;              // description length cap, in characters
const SENTENCE_END = /[。！？]/;

/** One sentence from the body: cut at sentence punctuation, else truncate. */
function makeDescription(body: string, fallback: string) {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    // Skip images, headings, lists, quotes, tables and rules
    if (!line || /^([!#>|]|[-+*]\s|-{3,}|\d+\.\s)/.test(line)) continue;
    const m = line.match(new RegExp(`^(.{4,${MAX}}?${SENTENCE_END.source})`));
    if (m) return m[1];
    return line.length > MAX - 2 ? line.slice(0, MAX - 2) + "…" : line;
  }
  return fallback;
}

/** Tags from the filename: YYYY-year is a yearly summary, YYYY-MM a monthly. */
function inferTags(slug: string) {
  const match = parsePostFilename(slug).period;
  switch (match?.kind) {
    case "year": return match.day === undefined ? ["summaries", "year"] : null;
    case "month": return ["summaries", "month"];
  }
  return null;   // no guess for an unrecognised name; a person picks the tags
}

const has = (fm: string, key: string) => new RegExp(`^${key}:\\s*\\S`, "m").test(fm);

/**
 * Frontmatter is handled with regular expressions rather than parsed as YAML.
 * Only the `description` and `tags` lines are touched, so everything else — a
 * +08:00 offset, a quoted title — survives exactly as written.
 */
export function prepareFrontmatter(src: string, slug: string, force = false) {
  let missingTags = false;
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { status: "no-frontmatter" as const };

  let [, fm, body] = m;
  const before = fm;
  const title = (fm.match(/^title:\s*"?(.*?)"?\s*$/m) || [, slug])[1];

  if (force || !has(fm, FIELD.desc)) {
    const d = makeDescription(body, title).replace(/"/g, "'");
    const line = `${FIELD.desc}: "${d}"`;
    fm = has(fm, FIELD.desc) || /^description:/m.test(fm)
      ? fm.replace(/^description:.*$/m, line)
      : `${fm}\n${line}`;
  }

  if (force || !has(fm, FIELD.tags)) {
    const t = inferTags(slug);
    if (t) {
      const line = `${FIELD.tags}:\n${t.map((x) => `  - ${x}`).join("\n")}`;
      fm = /^tags:/m.test(fm)
        ? fm.replace(/^tags:(\n(  - .*|\s*))*$/m, line)
        : `${fm}\n${line}`;
    } else {
      missingTags = true;
    }
  }

  return { status: "ready" as const, missingTags, changed: fm !== before, document: `---\n${fm}\n---\n${body}` };
}

// No YAML round-trip: the frontmatter's order, blank lines and quoting are deliberate.
export function pinPost(text: string, remove: boolean) {
  const end = text.indexOf("\n---", 4);
  if (!text.startsWith("---\n") || end < 0) return { status: "no-frontmatter" as const };
  const head = text.slice(4, end).split("\n");
  const body = text.slice(end + 1);
  const at = head.findIndex((line) => /^pinned\s*:/.test(line));
  if (remove) {
    if (at < 0) return { status: "unchanged" as const };
    head.splice(at, 1);
  } else if (at >= 0) {
    head[at] = "pinned: true";
  } else {
    // After the title: this is a fact about the post itself, not something to
    // sit among the tags or the description.
    const title = head.findIndex((line) => /^title\s*:/.test(line));
    head.splice(title < 0 ? head.length : title + 1, 0, "pinned: true");
  }
  return { status: "write" as const, document: `---\n${head.join("\n")}\n${body}` };
}
