/**
 * `virtual:platform` is aliased in astro.config.mjs to one of the files beside
 * this one, chosen by DEPLOY_TARGET. TypeScript cannot see through a Vite
 * alias, so the shape is declared here.
 */
declare module "virtual:platform" {
  import type { Platform } from "./types";
  export const platform: Platform;
}
