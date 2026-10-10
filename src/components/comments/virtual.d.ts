/** The build selects these implementations before Vite resolves the aliases. */
declare module "virtual:comments-section" {
  const CommentsSection: import("astro/runtime/server/index.js").AstroComponentFactory;
  export default CommentsSection;
}

declare module "virtual:note-comments" {
  const NoteComments: import("astro/runtime/server/index.js").AstroComponentFactory;
  export default NoteComments;
}
