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
import { notes, promotedComments } from "../src/data.config.generated.mjs";

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

export function entryFor(document, activityId) {
  return document?.comments?.find((entry) => entry.activityId === activityId);
}

export function locate(documents, activityId) {
  for (const { path, document } of documents) {
    const index = document?.comments?.findIndex((entry) => entry.activityId === activityId) ?? -1;
    if (index >= 0) return { path, document, index };
  }
  return undefined;
}

function noteYear(id) {
  let filesInNotes;
  try {
    filesInNotes = readdirSync(NOTES);
  } catch {
    return null;
  }
  for (const name of filesInNotes) {
    if (!name.endsWith(".json")) continue;
    const document = JSON.parse(readFileSync(join(NOTES, name), "utf8"));
    if (document.notes.some((note) => note.id === id)) return name.slice(0, -5);
  }
  return null;
}

export function fileFor(rootId) {
  const match = /\/users\/[^/]+\/notes\/([^/?#]+)$/.exec(rootId);
  if (!match) return null;
  const year = noteYear(match[1]);
  return year === null
    ? postArchivePath(match[1])
    : join(DIR, "notes", `${year}.json`);
}

export function postArchivePath(slug) {
  return join(DIR, "posts", `${slug}.json`);
}

export function writeDocument(path, document) {
  if ((document.comments ?? []).length === 0) {
    // An empty file describes a conversation that is not there.
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}
