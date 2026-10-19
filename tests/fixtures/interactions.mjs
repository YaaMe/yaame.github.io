import { SOURCES, commentId, identityId } from "../../src/lib/interactions/key-scheme.ts";
import { comments, visitorIdentities } from "../../src/data.config.generated.mjs";

export function storedComment(name = "one", extra = {}) {
  const value = {
    source: SOURCES.activitypub,
    identifier: `https://example.test/users/${name}`,
    activityId: `https://example.test/activity/${name}`,
    objectId: `https://example.test/object/${name}`,
    inReplyTo: "https://yaame.dev/users/yaame/notes/example",
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

export function seedComment(database, name = "one", extra = {}) {
  const record = storedComment(name, extra);
  const identity = { id: record.authorId, source: record.source, identifier: record.identifier, name: null };
  for (const [location, row] of [[visitorIdentities, identity], [comments, record]]) {
    database.prepare(`INSERT INTO ${location.table} (${Object.values(location.quotedColumns).join(", ")}) VALUES (${Object.keys(location.columns).map(() => "?").join(", ")})`)
      .run(...Object.keys(location.columns).map((column) => row[column]));
  }
  return record;
}
