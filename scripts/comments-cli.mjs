import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** JSON is the process boundary; diagnostics go to stderr, results to stdout. */
export function readInput() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.rows)) {
    throw new Error("Expected an object with rows on stdin");
  }
  return input.rows;
}

export function commandOptions(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--sql") options.sql = true;
    else if (flag === "--delete-sql") options.sqlOperation = "delete";
    else if (flag === "--apply") options.apply = true;
    else if (flag === "--pr-ref" || flag === "--id") {
      const value = argv[++index];
      if (!value) throw new Error(`${flag} needs a value`);
      options[flag === "--pr-ref" ? "prRef" : "id"] = value;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
}

export async function runCommand({
  entry,
  main,
  sql,
  hint = false,
  argv = process.argv.slice(2),
}) {
  if (!process.argv[1] || pathToFileURL(process.argv[1]).href !== entry) return;
  const flags = commandOptions(argv);
  if (flags.sql) {
    console.log(sql(flags));
    return;
  }
  const merged = { rows: readInput(), apply: false };
  if (flags.apply) merged.apply = true;
  for (const name of ["apply", "prRef", "id"]) {
    if (flags[name] !== undefined) merged[name] = flags[name];
  }
  return runCli(() => main(merged), { hint, apply: merged.apply === true });
}

export async function runCli(handler, { hint = false, apply = false } = {}) {
  try {
    const result = await handler();
    console.log(JSON.stringify(result));
    if (hint && !apply && result?.shouldWrite === true) {
      console.error(process.env.APPLY_HINT || "--apply");
    }
    return result;
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
