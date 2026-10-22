/** Filesystem access to the notes archive. */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { notes } from "../src/config/data.config.generated.mjs";
import { takenNoteIds, newNoteId, appendNote } from "../src/services/authoring/notes.ts";

export const DIR = notes.gitRoot;

export function takenIds() {
  if (!existsSync(DIR)) return new Set();
  const documents = readdirSync(DIR).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(DIR, name), "utf8")));
  return takenNoteIds(documents);
}

export function newId(taken = takenIds()) {
  return newNoteId(taken, Math.random);
}

/**
 * Add a note to a year.
 *
 * `year` is the caller's to choose, and it decides the permalink: the site
 * builds `/notes/{year}/#{id}` from the filename, never from the timestamp.
 */
export function append(note, year) {
  const file = join(DIR, `${year}.json`);
  const document = appendNote(existsSync(file) ? readFileSync(file, "utf8") : undefined, note);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, document);
  return file;
}
