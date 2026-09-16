// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://blogu.yaa.me",
  // Links are still emitted with a trailing slash — that is the external
  // contract, and `build.format: "directory"` is what keeps it. This setting
  // only decides whether the slashless form is a 404, and it must not be:
  // an ActivityPub actor id carries no trailing slash, and WebFinger's path is
  // fixed by the protocol at /.well-known/webfinger. Under "always" both
  // answered 404, measured.
  trailingSlash: "ignore",
  build: { format: "directory" },
});
