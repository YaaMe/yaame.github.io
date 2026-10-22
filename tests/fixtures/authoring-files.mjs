import { interactionRecordFiles } from "./interaction-record-files.mjs";

export const authoringFiles = [
  "scripts/data-config.mjs", "scripts/tags.mjs", "scripts/newtag.mjs", "scripts/newpost.mjs",
  "scripts/frontmatter.mjs", "scripts/note.mjs", "scripts/notes-store.mjs", "scripts/comments-store.mjs",
  "scripts/pin.mjs", "scripts/follow.mjs", "scripts/new.mjs",
  "src/config/data.config.ts", "src/config/data.config.json", "src/config/following.json",
  "src/lib/key-pattern.ts", "src/services/recovery/sql-text.ts", "src/services/recovery/errors.ts",
  "src/persistence/interactions/sql-text.ts", "src/models/content/post-filename.ts",
  "src/services/authoring/posts.ts", "src/services/authoring/tags.ts",
    "src/services/authoring/notes.ts", "src/services/authoring/following.ts",
    "src/gateways/activitypub/publication-probe.ts", ...interactionRecordFiles, "src/models/content/comments.ts",
  "src/selectors/interactions/comment-archive.ts", "src/services/interactions/comment-archive.ts",
];
