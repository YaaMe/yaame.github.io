const PARAMETER = /\{(\w+)\}/g;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g,
  (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export function fillPath(template: string, values: Record<string, string>): string {
  return template.replace(PARAMETER, (_match, name: string) => {
    if (!(name in values)) throw new Error(`missing path value: ${name}`);
    return encode(values[name]);
  });
}

export function matchUrl(template: string, url: string, fixed: Record<string, string> = {}): Record<string, string> | null {
  try {
    const names: string[] = [];
    let end = 0;
    let pattern = "^";
    for (const match of template.matchAll(PARAMETER)) {
      pattern += escape(template.slice(end, match.index));
      const name = match[1];
      if (name in fixed) pattern += escape(encode(fixed[name]));
      else {
        names.push(name);
        pattern += "(.*?)";
      }
      end = match.index + match[0].length;
    }
    pattern += escape(template.slice(end)) + "$";
    const matched = new RegExp(pattern).exec(new URL(url).href);
    if (!matched) return null;
    return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(matched[i + 1])]));
  } catch {
    return null;
  }
}
