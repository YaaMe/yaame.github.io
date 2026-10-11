import { readFileSync } from "node:fs";

function registerError(error) {
  if (Array.isArray(error?.issues)) {
    for (const issue of error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<register>";
      console.error(`  data register ${path}: ${issue.message}`);
    }
    return;
  }
  console.error(`  data register: ${error?.message ?? error}`);
}

let module;
try {
  module = await import("../src/data.config.generated.mjs");
} catch (error) {
  registerError(error);
  process.exit(1);
}

const { comments, promotedComments } = module;
const promotedGit = promotedComments.git;
const promotedRoot = promotedComments.gitRoot;
const commentsSql = { sql: comments.sql, columns: comments.columns };

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(`  data register consumer ${path}: ${error.message}`);
    process.exit(1);
  }
}

function requires(path, fragment) {
  const source = read(path);
  if (!source.includes(fragment)) {
    console.error(`  data register consumer ${path}: expected ${fragment}`);
    process.exitCode = 1;
  }
  return source;
}

function requiresPattern(path, pattern, label) {
  const source = read(path);
  if (!pattern.test(source)) {
    console.error(`  data register consumer ${path}: expected ${label}`);
    process.exitCode = 1;
  }
  return source;
}

const content = requires("src/content.config.ts", 'from "./data.config.generated.mjs"');
requires("src/content.config.ts", "const promotedCommentsGlob = promotedComments.glob");
requires("src/content.config.ts", "loader: glob(promotedCommentsGlob)");

const schema = requires("src/integrations/activitypub/store/schema.ts", 'from "../../../data.config.generated.mjs"');
requires("src/integrations/activitypub/store/schema.ts", "commentsLocation.columns");
requiresPattern(
  "src/integrations/activitypub/store/schema.ts",
  /sqliteTable\s*\(\s*commentsLocation\.sql/,
  "sqliteTable(commentsLocation.sql)",
);
for (const field of Object.keys(commentsSql.columns)) {
  requires("src/integrations/activitypub/store/schema.ts", `commentsColumns.${field}`);
}

const promote = requires("scripts/promote.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/promote.mjs", "promotedComments.gitRoot");
requires("scripts/promote.mjs", "comments.quotedColumns");
for (const field of ["activityId", "objectId", "rootId", "replyToId", "actorId", "content", "published", "promotedAt", "deletedAt"]) {
  requires("scripts/promote.mjs", `column("${field}")`);
}
requires("scripts/promote.mjs", "FROM ${table}");
requires("scripts/promote.mjs", "UPDATE ${table}");

const tombstone = requires("scripts/tombstone.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/tombstone.mjs", "promotedComments.gitRoot");
requires("scripts/tombstone.mjs", "comments.quotedColumns");
for (const field of ["activityId", "deletedAt", "promotedAt"]) {
  requires("scripts/tombstone.mjs", `column("${field}")`);
}
requires("scripts/tombstone.mjs", "FROM ${table}");

requires("scripts/note.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/note.mjs", "promotedComments.gitRoot");
const workflow = requires(".github/workflows/tombstones.yml", "node scripts/tombstone.mjs");
requires(".github/workflows/tombstones.yml", "make data");
requires(
  ".github/workflows/tombstones.yml",
  'promoted_comments_root=$(node --input-type=module -e \'import { promotedComments } from "./src/data.config.generated.mjs"; console.log(promotedComments.gitRoot)\')',
);
requires(
  ".github/workflows/tombstones.yml",
  'git diff --quiet -- "$promoted_comments_root"',
);
requires(
  ".github/workflows/tombstones.yml",
  'git add -- "$promoted_comments_root"',
);

const pathConsumers = [
  ["src/content.config.ts", content],
  ["scripts/promote.mjs", promote],
  ["scripts/tombstone.mjs", tombstone],
  ["scripts/note.mjs", read("scripts/note.mjs")],
  [".github/workflows/tombstones.yml", workflow],
];
for (const [path, source] of pathConsumers) {
  if (source.includes(promotedGit) || source.includes(promotedRoot)) {
    console.error(`  data register consumer ${path}: repeats promoted-comments git path ${promotedGit}`);
    process.exitCode = 1;
  }
}

for (const [path, source] of [["scripts/promote.mjs", promote], ["scripts/tombstone.mjs", tombstone]]) {
  if (new RegExp(`(?:FROM|UPDATE|INTO|JOIN)\\s+["']?${commentsSql.sql}\\b`, "i").test(source)) {
    console.error(`  data register consumer ${path}: repeats comments table ${commentsSql.sql}`);
    process.exitCode = 1;
  }
  for (const [field, column] of Object.entries(commentsSql.columns)) {
    if (column !== field && new RegExp(`\\b${column.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`).test(source)) {
      console.error(`  data register consumer ${path}: repeats comments column ${column}`);
      process.exitCode = 1;
    }
  }
}

// Migration strings are shipped schema history. The live Drizzle declaration
// below them must still take its table and columns from the register.
const liveSchema = schema.slice(0, schema.indexOf("export const reactions"));
if (new RegExp(`sqliteTable\\s*\\(\\s*["']${commentsSql.sql}["']`).test(liveSchema)) {
  console.error(`  data register consumer src/integrations/activitypub/store/schema.ts: repeats comments table ${commentsSql.sql}`);
  process.exitCode = 1;
}
for (const column of Object.values(commentsSql.columns)) {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?:text|integer|real|blob)\\s*\\(\\s*["']${escaped}["']`).test(liveSchema)) {
    console.error(`  data register consumer src/integrations/activitypub/store/schema.ts: repeats comments column ${column}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) process.exit(1);
console.log("  ✓ data register and consumers agree");
