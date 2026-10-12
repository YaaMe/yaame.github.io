import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

export async function runIfMain(moduleUrl, cli) {
  if (!process.argv[1] || process.argv[1] === "-") return;
  try {
    if (moduleUrl !== pathToFileURL(realpathSync(process.argv[1])).href) return;
    await cli();
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
