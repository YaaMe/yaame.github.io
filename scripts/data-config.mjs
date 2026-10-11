import { readFileSync, writeFileSync } from "node:fs";
import { dataConfigSchema } from "../src/data.config.ts";

const registerPath = new URL("../src/data.config.json", import.meta.url);
const modulePath = new URL("../src/data.config.generated.mjs", import.meta.url);
const typesPath = new URL("../src/data.config.generated.d.ts", import.meta.url);

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
    throw new Error(`data register entry ${kind} git path is not a glob: ${path}`);
  }
  const root = path.slice(0, slash);
  return {
    git: path,
    gitRoot: root,
    glob: { base: `./${root}`, pattern: path.slice(slash + 1) },
  };
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

function propertyTypes(value, indent = "  ") {
  return Object.entries(value)
    .map(([key, nested]) => {
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return `${indent}readonly ${key}: {\n${propertyTypes(nested, `${indent}  `)}\n${indent}};`;
      }
      return `${indent}readonly ${key}: string;`;
    })
    .join("\n");
}

function generateTypes(comments, promotedComments) {
  return [
    "// generated from src/data.config.json, do not edit",
    "",
    "export declare const comments: {",
    propertyTypes(comments),
    "};",
    "",
    "export declare const promotedComments: {",
    propertyTypes(promotedComments),
    "};",
    "",
  ].join("\n");
}

function generateModule(comments, promotedComments) {
  return [
    "// generated from src/data.config.json, do not edit",
    "",
    `export const comments = ${JSON.stringify(comments, null, 2)};`,
    "",
    `export const promotedComments = ${JSON.stringify(promotedComments, null, 2)};`,
    "",
  ].join("\n");
}

try {
  const raw = JSON.parse(readFileSync(registerPath, "utf8"));
  const config = dataConfigSchema.parse(raw);
  const comments = sqlValues(config, "comments");
  const promotedComments = gitValues(config, "promoted-comments");
  writeFileSync(modulePath, generateModule(comments, promotedComments));
  writeFileSync(typesPath, generateTypes(comments, promotedComments));
} catch (error) {
  registerError(error);
  process.exitCode = 1;
}
