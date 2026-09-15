// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://blogu.yaa.me",
  // Trailing slashes, as Hexo served them. This is an external contract.
  trailingSlash: "always",
  build: { format: "directory" },
});
