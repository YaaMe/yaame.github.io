/**
 * The tables, declared once for both hosts.
 *
 * Drizzle renders these into SQLite for D1 and for node:sqlite. Scripts also
 * send raw SQL to these tables, so a column change must reach them too.
 *
 * Times are ISO 8601 strings. SQLite has no date type, every dialect reads an
 * ISO string the same way, and a numeric epoch would have to be decoded by hand
 * wherever it is read.
 */
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  comments as commentsLocation,
  deliveries as deliveriesLocation,
  followers as followersLocation,
  reactions as reactionsLocation,
  visitorIdentities as identitiesLocation,
} from "../../../config/data.config.generated.mjs";

const commentsColumns = commentsLocation.columns;
const reactionsColumns = reactionsLocation.columns;
const identityColumns = identitiesLocation.columns;
const followerColumns = followersLocation.columns;
const deliveryColumns = deliveriesLocation.columns;

export const visitorIdentities = sqliteTable(identitiesLocation.sql, {
  id: text(identityColumns.id).primaryKey(),
  source: text(identityColumns.source).notNull(),
  identifier: text(identityColumns.identifier).notNull(),
  name: text(identityColumns.name),
});

export const comments = sqliteTable(
  commentsLocation.sql,
  {
    id: text(commentsColumns.id).primaryKey(),
    source: text(commentsColumns.source).notNull(),
    identifier: text(commentsColumns.identifier).notNull(),
    // The application maintains authorId and replyTo references; the database intentionally does not enforce them.
    authorId: text(commentsColumns.authorId).notNull(),
    activityId: text(commentsColumns.activityId),
    objectId: text(commentsColumns.objectId),
    submissionId: text(commentsColumns.submissionId),
    inReplyTo: text(commentsColumns.inReplyTo),
    root: text(commentsColumns.root).notNull(),
    replyTo: text(commentsColumns.replyTo),
    content: text(commentsColumns.content).notNull(),
    published: text(commentsColumns.published).notNull(),
    receivedAt: text(commentsColumns.receivedAt).notNull(),

    /**
     * Set when a Delete arrives. The row stays: we still owe a record that
     * something was here, and a promoted comment needs one to raise a removal
     * against.
     */
    deletedAt: text(commentsColumns.deletedAt),

    /** Set when carried into git — the point it stops being ours to erase. */
    promotedAt: text(commentsColumns.promotedAt),
  },
  (t) => [
    // Index columns run broad to narrow, matching the queries that read them;
    // change an order only together with its query.
    index("comments_by_thread").on(t.root, t.published),
    index("comments_by_actor").on(t.authorId, t.published),
    index("comments_by_object").on(t.objectId),
  ],
);

/**
 * Boosts and likes.
 *
 * One table for both, because they differ only in the verb: same sender, same
 * target, same undo. Splitting them would duplicate the whole shape to record
 * a word that fits in a column.
 */
export const reactions = sqliteTable(
  reactionsLocation.sql,
  {
    id: text(reactionsColumns.id).primaryKey(),
    source: text(reactionsColumns.source).notNull(),
    identifier: text(reactionsColumns.identifier).notNull(),
    // The application maintains the authorId reference; the database intentionally does not enforce it.
    authorId: text(reactionsColumns.authorId).notNull(),
    activityId: text(reactionsColumns.activityId).notNull(),

    /** The object URL as received; `target` is derived from it. */
    objectId: text(reactionsColumns.objectId).notNull(),
    target: text(reactionsColumns.target).notNull(),

    /** `Announce` or `Like`. */
    kind: text(reactionsColumns.kind).notNull(),

    receivedAt: text(reactionsColumns.receivedAt).notNull(),

    /**
     * Set when an Undo arrives. The row stays rather than being deleted, so a
     * repeat of the original activity is still refused by the primary key —
     * deleting it would let the same boost be counted again.
     */
    undoneAt: text(reactionsColumns.undoneAt),
  },
  (t) => [
    // Broad to narrow — content, kind, author — so the per-content count of
    // distinct authors reads the index alone; change it only with that query.
    index("reactions_by_target").on(t.target, t.kind, t.authorId),
  ],
);

/**
 * Who follows this account: one row per visitor identity, from any source.
 *
 * The id is the follower's visitor identity id, so a follow and an unfollow
 * each touch only their own row and two arriving together cannot overwrite
 * each other.
 */
export const followers = sqliteTable(
  followersLocation.sql,
  {
    // Also a visitor identity id, which the application inserts first; the database intentionally does not enforce it.
    id: text(followerColumns.id).primaryKey(),
    source: text(followerColumns.source).notNull(),
    identifier: text(followerColumns.identifier).notNull(),

    /**
     * Federated rows only, and required there. Nullable and nothing more in
     * the database: the stored schema enforces the rule on every write and on
     * recovery, so a writer that skips that schema can break it. Stored, not derived:
     * `<actor>/inbox` is Mastodon's layout rather than a rule, and deriving it
     * posts to a 404 on anything that chose otherwise — silently, because
     * delivery is asynchronous and no one is waiting.
     */
    inbox: text(followerColumns.inbox),
    sharedInbox: text(followerColumns.sharedInbox),
    followId: text(followerColumns.followId),
    followedAt: text(followerColumns.followedAt).notNull(),
  },
  (t) => [
    // Broad to narrow, each matching its query: one source's followers newest
    // first, and one source's rows at a written-off inbox. Change an order only
    // together with its query.
    index("followers_by_source").on(t.source, t.followedAt, t.id),
    index("followers_by_inbox").on(t.source, t.inbox),
  ],
);

/**
 * Content handed over for delivery, one row per channel and post.
 *
 * A row is written only after its own hand-over succeeded, so a post without
 * one is still pending on that channel. Retrying what was handed over is the
 * channel's job.
 */
export const deliveries = sqliteTable(
  deliveriesLocation.sql,
  {
    id: text(deliveryColumns.id).primaryKey(),
    channel: text(deliveryColumns.channel).notNull(),
    target: text(deliveryColumns.target).notNull(),
    enqueuedAt: text(deliveryColumns.enqueuedAt).notNull(),
  },
  (t) => [
    // Channel, then content, so one channel's marks read the index alone;
    // change it only with that query.
    index("deliveries_by_channel").on(t.channel, t.target),
  ],
);
