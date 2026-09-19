#!/usr/bin/env node
/**
 * Write a note.
 *
 *   make po test
 *   make po 今天读完了这本书 https://example.com
 *   make po T="use this when the text holds # or $"
 *
 * Appended to src/content/notes/<year>.json. The body is read as markdown:
 * plain text is valid markdown, and an unparsed link shows as a bare URL.
 *
 * This is the terminal half of publishing — straight into git, visible after a
 * commit and a deploy. The other half writes D1 from the routing layer, is
 * federated at once, and is promoted back into git afterwards. Both land in the
 * same place.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/content/notes";
const text = process.argv.slice(2).join(" ").trim();

if (!text) {
  console.error("  用法：make po 正文    或    make po T=\"正文\"");
  process.exit(1);
}

/**
 * The id is not the time.
 *
 * Several notes in one day are ordinary, so a timestamp cannot be an identity.
 * A non-date-shaped string also keeps this namespace clear of the long posts,
 * whose slugs are date-shaped (`2025-year`, `2023-07`) and share
 * `/users/…/notes/`.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l/o/0/1: read aloud without error
const makeId = () =>
  Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

// Every year's ids are read. A collision is negligible, and the difference
// between negligible and checked is the one irreversible thing here: once an id
// is published it is that note's identity.
const taken = new Set();
if (existsSync(DIR)) {
  for (const name of readdirSync(DIR)) {
    if (!name.endsWith(".json")) continue;
    for (const note of JSON.parse(readFileSync(join(DIR, name), "utf8")).notes) {
      taken.add(note.id);
    }
  }
}

let id = makeId();
while (taken.has(id)) id = makeId();

const now = new Date();
const file = join(DIR, `${now.getUTCFullYear()}.json`);
const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { notes: [] };

doc.notes.push({ id, published: now.toISOString().replace(/\.\d{3}Z$/, "Z"), content: text });
doc.notes.sort((a, b) => a.published.localeCompare(b.published));

mkdirSync(DIR, { recursive: true });
writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);

console.log(`  ${file}  ${id}`);
console.log(`  ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
console.log("\n  提交并部署之后它会被投递给关注者。");
