import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "@astrojs/compiler-rs";
import { build } from "esbuild";

let loads = 0;

export async function authRuntime({ render = false } = {}) {
  const bundle = await build({
    stdin: {
      contents: `
        export { create, current, destroy, readSession } from "./src/services/auth/session.ts";
        export { AUTH } from "./src/config/auth.ts";
        export { GET as callbackResponse } from "./src/routes/auth/callback.ts";
        export { GET as githubLogin } from "./src/routes/auth/github.ts";
        export * as logoutRoute from "./src/routes/auth/logout.ts";
        export { records, reads, writes, removed, faults, settings } from "virtual:platform";
        ${render ? `
          export { default as Login } from "./src/pages-extra/auth/login.astro";
          export { default as Island } from "./src/components/session/server.astro";
        ` : ""}
      `,
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "auth-runtime",
      setup(builder) {
        builder.onResolve({ filter: /^virtual:platform$/ }, () => ({ path: "platform", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
            export const records = new Map();
            export const reads = [], writes = [], removed = [];
            export const faults = { get: null, put: null, remove: null };
            export const settings = { configured: true };
            export const platform = {
              secret: () => settings.configured ? "test-secret" : undefined,
              get: async (key) => {
                reads.push(key);
                if (faults.get) throw faults.get(key);
                return records.get(key) ?? null;
              },
              put: async (key, value, options) => {
                if (faults.put) throw faults.put(key);
                writes.push({ key, options });
                records.set(key, value);
              },
              remove: async (key) => {
                if (faults.remove) throw faults.remove(key);
                removed.push(key);
                records.delete(key);
              },
            };
          `,
        }));
        // The deferred island is rendered separately with its own request.
        builder.onResolve({ filter: /^virtual:session-bar$/ }, () => ({
          path: fileURLToPath(new URL("../../src/components/session/static.astro", import.meta.url)),
        }));
        builder.onLoad({ filter: /\.astro$/ }, async ({ path }) => ({
          contents: transform(await readFile(path, "utf8"), {
            filename: path,
            internalURL: "astro/compiler-runtime",
            resultScopedSlot: true,
            inlineComponentAssets: true,
            resolvePath: (specifier) => specifier,
          }).code,
          loader: "ts",
          resolveDir: dirname(path),
        }));
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
        builder.onResolve({ filter: /^astro\// }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
      },
    }],
  });
  // Identical data URLs share a module cache, including its fake records.
  const source = `${bundle.outputFiles[0].text}\n// ${++loads}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
