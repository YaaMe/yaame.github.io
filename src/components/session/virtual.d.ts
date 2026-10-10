/** The build selects the full or empty implementation before Vite resolves this import. */
declare module "virtual:session-bar" {
  const SessionBar: import("astro/runtime/server/index.js").AstroComponentFactory;
  export default SessionBar;
}
