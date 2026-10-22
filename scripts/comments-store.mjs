/**
 * The promoted comment archive, as the scripts that reconcile it see it.
 *
 * There is one owner for finding, reading and writing archive documents. An
 * empty document is not an archive entry; its file is removed.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { notes, promotedComments } from "../src/config/data.config.generated.mjs";
import { archivePath, entryFor, postArchivePath as postPath } from "../src/selectors/interactions/comment-archive.ts";
import { archiveWrite } from "../src/services/interactions/comment-archive.ts";

export const DIR = promotedComments.gitRoot;
const NOTES = notes.gitRoot;

function* files(dir) {
  let entries;
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (name.endsWith(".json")) yield path;
  }
}

export function readDocuments(dir = DIR) {
  return [...files(dir)].map((path) => ({
    path,
    document: JSON.parse(readFileSync(path, "utf8")),
  }));
}

export function readRefDocument(ref, path) {
  try {
    return JSON.parse(execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" }));
  } catch (error) {
    if (error?.status === 128) return undefined;
    throw error;
  }
}

export function readRefDocuments(ref, dir = DIR) {
  const names = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", dir], {
    encoding: "utf8",
  }).trim();
  if (!names) return [];
  return names
    .split("\n")
    .filter((path) => path.endsWith(".json"))
    .map((path) => ({ path, document: readRefDocument(ref, path) }))
    .filter(({ document }) => document !== undefined);
}

/**
 * Archive entries as a git ref holds them; each document is read from git once.
 * With `preload`, every archive document is read now, so `documents()` lists
 * them all; without it, a document is read the first time it is asked about.
 */
export function refEntries(ref, { preload = false } = {}) {
  const documents = new Map(preload ? readRefDocuments(ref).map(({ path, document }) => [path, document]) : []);
  const entry = ({ path, id }) => {
    if (!preload && !documents.has(path)) documents.set(path, readRefDocument(ref, path));
    return entryFor(documents.get(path), id);
  };
  entry.documents = () => [...documents].map(([path, document]) => ({ path, document }));
  return entry;
}

function* noteDocuments() {
  let filesInNotes;
  try {
    filesInNotes = readdirSync(NOTES);
  } catch {
    return null;
  }
  for (const name of filesInNotes) {
    if (!name.endsWith(".json")) continue;
    const document = JSON.parse(readFileSync(join(NOTES, name), "utf8"));
    yield { name, document };
  }
  return null;
}

export function fileFor(root) {
  const path = archivePath(root, noteDocuments());
  return path === null ? null : join(DIR, ...path);
}

export function postArchivePath(slug) {
  return join(DIR, ...postPath(slug));
}

export function writeDocument(path, document) {
  const plan = archiveWrite(document);
  if (plan.remove) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}
