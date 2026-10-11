import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dataConfigSchema } from "../src/data.config.ts";

const registerPath = new URL("../src/data.config.json", import.meta.url);
const modulePath = new URL("../src/data.config.generated.mjs", import.meta.url);
const typesPath = new URL("../src/data.config.generated.d.ts", import.meta.url);
const projectRoot = dirname(dirname(fileURLToPath(registerPath)));

function registerError(error) {
  if (Array.isArray(error?.issues)) {
    for (const issue of error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<register>";
      console.error(`  data register ${path}: ${issue.message}`);
    }
    return;
  }
  console.error(`  data register: ${error?.message ?? error}`);
}

function layerFor(config, kind, key) {
  const entry = config[kind];
  const layer = entry?.layers?.find((candidate) => Object.hasOwn(candidate, key));
  if (!layer) throw new Error(`data register entry ${kind} has no ${key} layer`);
  return layer;
}

function firstGlob(path) {
  return [...path].findIndex((character) => "*?{[".includes(character));
}

function gitValues(config, kind) {
  const path = layerFor(config, kind, "git").git;
  const index = firstGlob(path);
  const slash = path.lastIndexOf("/", index < 0 ? path.length : index);
  if (slash < 0 || slash === path.length - 1) {
    throw new Error(`data register entry ${kind} git path is not a file or glob: ${path}`);
  }
  const root = path.slice(0, slash);
  const values = {
    git: path,
    gitRoot: root,
    glob: { base: `./${root}`, pattern: path.slice(slash + 1) },
  };
  if (index < 0) values.file = path;
  return values;
}

function resolvedValues(config, kind, seen = []) {
  if (seen.includes(kind)) {
    throw new Error(`data register ref cycle: ${[...seen, kind].join(" → ")}`);
  }
  const entry = config[kind];
  if (!entry) throw new Error(`data register ref points to missing entry ${kind}`);
  const git = entry.layers.find((candidate) => Object.hasOwn(candidate, "git"));
  if (git) return gitValues(config, kind);
  const ref = entry.layers.find((candidate) => Object.hasOwn(candidate, "ref"));
  if (ref) {
    return {
      ...resolvedValues(config, ref.ref, [...seen, kind]),
      ref: ref.ref,
      fields: [...ref.fields],
    };
  }
  throw new Error(`data register entry ${kind} has no resolvable git layer`);
}

function quotedIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`invalid SQL identifier in data register: ${value}`);
  }
  return `"${value}"`;
}

function sqlValues(config, kind) {
  const layer = layerFor(config, kind, "sql");
  const columns = { ...layer.columns };
  const quotedColumns = Object.fromEntries(
    Object.entries(columns).map(([name, value]) => [name, quotedIdentifier(value)]),
  );
  return {
    sql: layer.sql,
    table: quotedIdentifier(layer.sql),
    columns,
    quotedColumns,
  };
}

function exportName(kind) {
  return kind
    .split(/[.-]/)
    .map((part, index) => index === 0 ? part : part[0].toUpperCase() + part.slice(1))
    .join("");
}

function typeFor(value, indent = "  ") {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (value.length === 0) return "readonly never[]";
    return `readonly ${typeFor(value[0], indent)}[]`;
  }
  if (value && typeof value === "object") {
    return `{
${Object.entries(value)
  .map(([key, nested]) => `${indent}  readonly ${key}: ${typeFor(nested, `${indent}  `)};`)
  .join("\n")}
${indent}}`;
  }
  return "unknown";
}

function relativeImport(path) {
  const from = dirname(fileURLToPath(modulePath));
  let imported = relative(from, resolve(projectRoot, path)).replaceAll("\\", "/");
  if (!imported.startsWith(".")) imported = `./${imported}`;
  return imported;
}

function generateTypes(values, staticImports) {
  const lines = ["// generated from src/data.config.json, do not edit", ""];
  for (const [name, value] of values) {
    lines.push(`export declare const ${name}: ${typeFor(value)};`, "");
  }
  for (const [name] of staticImports) {
    lines.push(`export declare const ${name}: unknown;`, "");
  }
  return `${lines.join("\n")}\n`;
}

function generateModule(values, staticImports) {
  const lines = ["// generated from src/data.config.json, do not edit", ""];
  for (const [name, path] of staticImports) {
    lines.push(
      `import ${name} from ${JSON.stringify(relativeImport(path))} with { type: "json" };`,
      "",
    );
  }
  for (const [name, value] of values) {
    lines.push(`export const ${name} = ${JSON.stringify(value, null, 2)};`, "");
  }
  for (const [name] of staticImports) {
    lines.push(`export { ${name} };`, "");
  }
  return `${lines.join("\n")}\n`;
}

try {
  const raw = JSON.parse(readFileSync(registerPath, "utf8"));
  const config = dataConfigSchema.parse(raw);
  const values = [];
  const staticImports = [];

  for (const kind of Object.keys(config)) {
    const name = exportName(kind);
    let value;
    if (kind === "comments") value = sqlValues(config, kind);
    else if (kind === "promoted-comments") value = gitValues(config, kind);
    else value = resolvedValues(config, kind);

    const layer = config[kind].layers.find((candidate) => Object.hasOwn(candidate, "git"));
    if (kind === "follow-intent" && layer && firstGlob(layer.git) < 0) {
      values.push([`${name}Location`, value]);
      staticImports.push([name, layer.git]);
    } else {
      values.push([name, value]);
    }
  }

  writeFileSync(modulePath, generateModule(values, staticImports));
  writeFileSync(typesPath, generateTypes(values, staticImports));
} catch (error) {
  registerError(error);
  process.exitCode = 1;
}
