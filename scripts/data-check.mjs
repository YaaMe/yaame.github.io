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

const {
  actorDigest,
  delivered,
  departures,
  deliveryFailures,
  followLedger,
  followers,
  following,
  noteDigests,
  sessions,
  comments,
  komorebi,
  migrations,
  notes,
  posts,
  postsPinned,
  promotedComments,
  reactions,
  fedifyState,
  queueOrdering,
  followIntentLocation,
} = module;
const followIntentImport = `import followIntent from ${JSON.stringify(`./${followIntentLocation.file.replace(/^src\//, "")}`)} with { type: "json" };`;
requires("src/data.config.generated.mjs", followIntentImport);
requires("src/data.config.generated.mjs", "export { followIntent };");
const promotedGit = promotedComments.git;
const promotedRoot = promotedComments.gitRoot;
const commentsSql = { sql: comments.sql, columns: comments.columns };
const sqlLocations = [
  ["comments", comments],
  ["reactions", reactions],
  ["migrations", migrations],
];
if (fedifyState.memory !== "fedify" || Object.hasOwn(fedifyState, "records")) {
  console.error("  data register consumer: fedify-state must be the non-durable fedify memory store");
  process.exitCode = 1;
}
if (queueOrdering.records !== true || queueOrdering.list !== "never" || Object.hasOwn(queueOrdering, "key")) {
  console.error("  data register consumer: queue-ordering must leave keys to the records library");
  process.exitCode = 1;
}
if (typeof postsPinned?.gitRoot !== "string") {
  console.error("  data register consumer: posts.pinned did not resolve to the posts git location");
  process.exitCode = 1;
}

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
requires("src/content.config.ts", "const notesGlob = notesLocation.glob");
requires("src/content.config.ts", "const postsGlob = postsLocation.glob");
requires("src/content.config.ts", "const komorebiGlob = komorebiLocation.glob");
for (const globName of ["promotedComments", "notes", "posts", "komorebi"]) {
  const variable = globName === "promotedComments" ? "promotedCommentsGlob" : `${globName}Glob`;
  requires("src/content.config.ts", `loader: glob(${variable})`);
}

const schema = requires("src/integrations/activitypub/store/schema.ts", 'from "../../../data.config.generated.mjs"');
requires("src/integrations/activitypub/store/schema.ts", "commentsLocation.columns");
requires("src/integrations/activitypub/store/schema.ts", "reactionsLocation.columns");
requires("src/integrations/activitypub/store/schema.ts", "migrationsLocation.table");
requiresPattern("src/integrations/activitypub/store/schema.ts", /sqliteTable\s*\(\s*commentsLocation\.sql/, "sqliteTable(commentsLocation.sql)");
requiresPattern("src/integrations/activitypub/store/schema.ts", /sqliteTable\s*\(\s*reactionsLocation\.sql/, "sqliteTable(reactionsLocation.sql)");
for (const field of Object.keys(commentsSql.columns)) {
  requires("src/integrations/activitypub/store/schema.ts", `commentsColumns.${field}`);
}
for (const field of Object.keys(reactions.columns)) {
  requires("src/integrations/activitypub/store/schema.ts", `reactionsColumns.${field}`);
}
for (const field of Object.keys(migrations.columns)) {
  requires("src/integrations/activitypub/store/schema.ts", `migrationsColumns.quotedColumns.${field}`);
}

const promote = requires("scripts/promote.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/promote.mjs", "promotedComments.gitRoot");
requires("scripts/promote.mjs", "notes.gitRoot");
requires("scripts/promote.mjs", "comments.quotedColumns");
for (const field of ["activityId", "objectId", "rootId", "replyToId", "actorId", "content", "published", "promotedAt", "deletedAt"]) {
  requires("scripts/promote.mjs", `column("${field}")`);
}
requires("scripts/promote.mjs", "FROM ${table}");
requires("scripts/promote.mjs", "UPDATE ${table}");

const tombstone = requires("scripts/tombstone.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/tombstone.mjs", "promotedComments.gitRoot");
requires("scripts/tombstone.mjs", "promotedComments.writeBack");
requires("scripts/tombstone.mjs", "comments.quotedColumns");
for (const field of ["activityId", "deletedAt", "promotedAt"]) {
  requires("scripts/tombstone.mjs", `column("${field}")`);
}
requires("scripts/tombstone.mjs", "FROM ${table}");

const note = requires("scripts/note.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/note.mjs", "promotedComments.gitRoot");
requires("scripts/note.mjs", "posts.gitRoot");
requires("scripts/note.mjs", "notes.gitRoot");
const notesStore = requires("scripts/notes-store.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/notes-store.mjs", "notes.gitRoot");
const newpost = requires("scripts/newpost.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/newpost.mjs", "posts.gitRoot");
const frontmatter = requires("scripts/frontmatter.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/frontmatter.mjs", "posts.gitRoot");
const pin = requires("scripts/pin.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/pin.mjs", "postsPinned.gitRoot");
const follow = requires("scripts/follow.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/follow.mjs", "followIntentLocation.file");
const tags = requires("scripts/tags.mjs", 'from "../src/data.config.generated.mjs"');
requires("scripts/tags.mjs", "posts.gitRoot");
requires("scripts/tags.mjs", "komorebi.gitRoot");
const federation = requires("src/integrations/activitypub/federation.ts", 'from "../../data.config.generated.mjs"');
requires("src/integrations/activitypub/federation.ts", "followIntent");
for (const name of ["actorDigest", "departures", "followLedger", "followers", "following"]) {
  requires("src/integrations/activitypub/federation.ts", name);
}
if (federation.includes("readFollowIntent") || federation.includes("await followIntent")) {
  console.error("  data register consumer src/integrations/activitypub/federation.ts: follow intent must be a static value");
  process.exitCode = 1;
}

const outbox = requires("src/integrations/activitypub/outbox.ts", 'from "../../data.config.generated.mjs"');
requires("src/integrations/activitypub/outbox.ts", "delivered");
requires("src/integrations/activitypub/outbox.ts", "noteDigests");
const session = requires("src/integrations/auth/session-core.ts", 'from "../../data.config.generated.mjs"');
requires("src/integrations/auth/session-core.ts", "sessions.key");
const worker = requires("worker/consumer.ts", 'from "../src/data.config.generated.mjs"');
requires("worker/consumer.ts", "deliveryFailures.key");
requires("Makefile", "build-consumer: data");
requires("Makefile", "deploy-consumer: data");

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
  ["scripts/note.mjs", note],
  ["scripts/notes-store.mjs", notesStore],
  ["scripts/newpost.mjs", newpost],
  ["scripts/frontmatter.mjs", frontmatter],
  ["scripts/pin.mjs", pin],
  ["scripts/follow.mjs", follow],
  ["scripts/tags.mjs", tags],
  ["src/integrations/activitypub/federation.ts", federation],
  ["src/integrations/activitypub/outbox.ts", outbox],
  ["src/integrations/auth/session-core.ts", session],
  ["worker/consumer.ts", worker],
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

// A source consumer must use a generated value. Strip comments before looking
// for old path literals, so explanatory prose cannot become a false copy.
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const sourceWithoutComments = pathConsumers
  .filter(([path]) => !path.startsWith(".github/"))
  .map(([path, source]) => [path, withoutComments(source)]);
const recordLocations = [
  ["actorDigest", actorDigest],
  ["delivered", delivered],
  ["departures", departures],
  ["deliveryFailures", deliveryFailures],
  ["followLedger", followLedger],
  ["followers", followers],
  ["following", following],
  ["noteDigests", noteDigests],
  ["sessions", sessions],
];
for (const [path, source] of sourceWithoutComments) {
  for (const [name, location] of recordLocations) {
    const prefix = location.records.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, "");
    if (source.includes(location.records) || (prefix && source.includes(prefix))) {
      console.error(`  data register consumer ${path}: repeats ${name} records key`);
      process.exitCode = 1;
    }
  }
}
const oldPathCopies = [
  ["posts", /(?:src\/)?content\/posts(?:\/|["'`])/, posts],
  ["notes", /(?:src\/)?content\/notes(?:\/|["'`])/, notes],
  ["komorebi", /(?:src\/)?content\/komorebi(?:\/|["'`])/, komorebi],
  ["follow-intent", /(?:src\/)?integrations\/activitypub\/following\.json|\.\/following\.json/, followIntentLocation],
];
for (const [path, source] of sourceWithoutComments) {
  for (const [kind, pattern, location] of oldPathCopies) {
    if (pattern.test(source)) {
      console.error(`  data register consumer ${path}: repeats ${kind} git path ${location.git}`);
      process.exitCode = 1;
    }
  }
}

const directLocationCopies = [
  ["src/content.config.ts", /glob\(\s*\{/],
  ["scripts/newpost.mjs", /\bconst DIR\s*=\s*["'`]/],
  ["scripts/frontmatter.mjs", /\bconst DIR\s*=\s*["'`]/],
  ["scripts/notes-store.mjs", /\b(?:const|export const) DIR\s*=\s*["'`]/],
  ["scripts/pin.mjs", /\bconst file\s*=\s*join\(\s*["'`]/],
  ["scripts/follow.mjs", /\bconst FILE\s*=\s*["'`]/],
  ["scripts/tags.mjs", /\bconst dir of \[\s*["'`]/],
  ["scripts/note.mjs", /\bconst (?:asPost|comments)\s*=\s*(?:join\(\s*["'`]|["'`])/],
  ["scripts/promote.mjs", /\bconst NOTES\s*=\s*["'`]/],
  ["src/integrations/activitypub/federation.ts", /(?:from|import\()\s*["'`][^"'`]*following\.json/],
];
for (const [path, pattern] of directLocationCopies) {
  const source = sourceWithoutComments.find(([candidate]) => candidate === path)?.[1];
  if (source && pattern.test(source)) {
    console.error(`  data register consumer ${path}: has a hardcoded registered location`);
    process.exitCode = 1;
  }
}

// Migration strings are shipped schema history. The live Drizzle declaration
// below them must still take its table and columns from the register.
const migrationStart = schema.indexOf("const MIGRATIONS");
const migrationEnd = schema.indexOf("/**\n * Bring a database", migrationStart);
const liveSchema = `${schema.slice(0, migrationStart)}${schema.slice(migrationEnd)}`;
const liveSchemaCode = withoutComments(liveSchema);
for (const [kind, location] of sqlLocations) {
  if (new RegExp(`sqliteTable\\s*\\(\\s*["']${location.sql}["']`).test(liveSchema)) {
    console.error(`  data register consumer src/integrations/activitypub/store/schema.ts: repeats ${kind} table ${location.sql}`);
    process.exitCode = 1;
  }
  const tableLiteral = new RegExp(
    "(?:sqliteTable\\s*\\(|\\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\\s+)[\"']" +
      location.sql +
      "[\"']",
  );
  if (tableLiteral.test(liveSchemaCode)) {
    console.error(`  data register consumer src/integrations/activitypub/store/schema.ts: repeats ${kind} table ${location.sql}`);
    process.exitCode = 1;
  }
  for (const column of Object.values(location.columns)) {
    const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:text|integer|real|blob)\\s*\\(\\s*["']${escaped}["']`).test(liveSchemaCode)) {
      console.error(`  data register consumer src/integrations/activitypub/store/schema.ts: repeats ${kind} column ${column}`);
      process.exitCode = 1;
    }
  }
}

if (process.exitCode) process.exit(1);
console.log("  ✓ data register and consumers agree");
