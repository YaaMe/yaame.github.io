// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://blogu.yaa.me",
  // Hexo 用的是 :year/:month/:day/:title/，带尾斜杠。
  // 这是对外契约，换框架不能破。
  trailingSlash: "always",
  build: { format: "directory" },
});
