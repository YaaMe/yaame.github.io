function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RECORD_KEY_PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/gu;

export function recordKeyPlaceholders(declaration: string): string[] {
  return [...declaration.matchAll(RECORD_KEY_PLACEHOLDER)].map((match) => match[1]);
}

export function isRecordKeyPattern(declaration: string): boolean {
  return recordKeyPlaceholders(declaration).length > 0;
}

export function recordKeyMatches(declaration: string, key: string): boolean {
  if (!isRecordKeyPattern(declaration)) return declaration === key;
  let offset = 0;
  let expression = "^";
  for (const match of declaration.matchAll(RECORD_KEY_PLACEHOLDER)) {
    expression += escapeRegex(declaration.slice(offset, match.index)) + ".+?";
    offset = match.index + match[0].length;
  }
  expression += escapeRegex(declaration.slice(offset)) + "$";
  return new RegExp(expression).test(key);
}
