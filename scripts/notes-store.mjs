/**
 * The notes archive, as the scripts that write it see it.
 *
 * Shared so there is one id space. Two generators would be two definitions of
 * what a note's identity is, and a collision between them would publish two
 * notes at one address.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const DIR = "src/content/notes";

/**
 * The id is not the time.
 *
 * Several notes in one day are ordinary, so a timestamp cannot be an identity.
 * A non-date-shaped string also keeps this namespace clear of the long posts,
 * whose slugs are date-shaped (`2025-year`, `2023-07`) and share
 * `/users/…/notes/`.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l/o/0/1: read aloud without error

/** Every id in every year. A published id is that note's identity for good. */
export function takenIds() {
  const taken = new Set();
  if (!existsSync(DIR)) return taken;
  for (const name of readdirSync(DIR)) {
    if (!name.endsWith(".json")) continue;
    for (const note of JSON.parse(readFileSync(join(DIR, name), "utf8")).notes) {
      taken.add(note.id);
    }
  }
  return taken;
}

export function newId(taken = takenIds()) {
  const make = () =>
    Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
  let id = make();
  while (taken.has(id)) id = make();
  return id;
}

/**
 * Add a note to a year.
 *
 * `year` is the caller's to choose, and it decides the permalink: the site
 * builds `/notes/{year}/#{id}` from the filename, never from the timestamp.
 */
export function append(note, year) {
  const file = join(DIR, `${year}.json`);
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { notes: [] };
  doc.notes.push(note);
  doc.notes.sort((a, b) => a.published.localeCompare(b.published));
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return file;
}
