/**
 * The host boundary.
 *
 * `virtual:platform` is aliased in astro.config.mjs to one of the files beside
 * this one, chosen by DEPLOY_TARGET before the build. The implementation for
 * the other target is never in the module graph, so its imports never have to
 * resolve — which is the point, since they only exist on their own runtime.
 */
export type { Platform } from "./types";
export { platform } from "virtual:platform";
