/**
 * `virtual:session` is aliased in astro.config.mjs to one of the two Session
 * components beside this file, chosen by BUILD_PROFILE before the build. The
 * static profile resolves to the one that renders nothing, so no deferred
 * island reaches its module graph and it keeps emitting no server entry.
 */
declare module "virtual:session" {
  const Session: (props: Record<string, unknown>) => unknown;
  export default Session;
}
