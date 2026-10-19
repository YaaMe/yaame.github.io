import { SOURCES, commentId, identityId, reactionId } from "../../src/lib/interactions/key-scheme.ts";
import { comments, reactions, visitorIdentities } from "../../src/data.config.generated.mjs";

export function storedComment(name = "one", extra = {}) {
  const value = {
    source: SOURCES.activitypub,
    identifier: `https://example.test/users/${name}`,
    activityId: `https://example.test/activity/${name}`,
    objectId: `https://example.test/object/${name}`,
    inReplyTo: `https://yaame.dev/users/yaame/notes/${extra.root ?? "example"}`,
    submissionId: null,
    root: "example",
    replyTo: null,
    content: `<p>${name}</p>`,
    published: "2026-10-10T00:00:00Z",
    receivedAt: "2026-10-10T00:01:00Z",
    deletedAt: null,
    promotedAt: null,
    ...extra,
  };
  return { id: commentId(value), authorId: identityId(value.source, value.identifier), ...value };
}

export function archivedComment(name = "one", extra = {}) {
  const record = storedComment(name);
  return {
    id: record.id,
    source: record.source,
    activityId: record.activityId,
    objectId: record.objectId,
    inReplyTo: record.inReplyTo,
    root: record.root,
    replyTo: record.replyTo,
    author: { id: record.authorId, source: record.source, identifier: record.identifier },
    content: [[{ type: "text", text: name }]],
    published: record.published,
    ...extra,
  };
}

export function physicalComment(name = "one", extra = {}) {
  const record = storedComment(name, extra);
  return Object.fromEntries(Object.entries(comments.columns).map(([logical, physical]) => [physical, record[logical]]));
}

export function storedReaction(name = "one", extra = {}) {
  const value = {
    source: SOURCES.activitypub,
    identifier: `https://example.test/users/${name}`,
    activityId: `https://example.test/activity/${name}`,
    objectId: `https://yaame.dev/users/yaame/notes/${extra.target ?? "example"}`,
    target: "example",
    kind: "Like",
    receivedAt: "2026-10-10T00:01:00Z",
    undoneAt: null,
    ...extra,
  };
  return { id: reactionId(value), authorId: identityId(value.source, value.identifier), ...value };
}

function seed(database, location, record) {
  const identity = { id: record.authorId, source: record.source, identifier: record.identifier, name: null };
  for (const [table, row, verb] of [[visitorIdentities, identity, "INSERT OR IGNORE"], [location, record, "INSERT"]]) {
    database.prepare(`${verb} INTO ${table.table} (${Object.values(table.quotedColumns).join(", ")}) VALUES (${Object.keys(table.columns).map(() => "?").join(", ")})`)
      .run(...Object.keys(table.columns).map((column) => row[column]));
  }
  return record;
}

export function seedComment(database, name = "one", extra = {}) {
  return seed(database, comments, storedComment(name, extra));
}

export function seedReaction(database, name = "one", extra = {}) {
  return seed(database, reactions, storedReaction(name, extra));
}
