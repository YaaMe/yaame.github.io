source "$(dirname -- "${BASH_SOURCE[0]}")/../flags.sh"

require_d1() {
  if [[ -z ${CF_D1_ID:-} ]]; then
    echo "  需要 CF_D1_ID" >&2
    return 1
  fi
  node scripts/wrangler-config.mjs >/dev/null
  DB_NAME=$(node scripts/resource-names.mjs database)
}

d1_json() {
  local sql=$1
  npx wrangler d1 execute "$DB_NAME" --remote --json --command "$sql" |
    node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const text = readFileSync(0, "utf8");
      const start = text.indexOf("[");
      if (start < 0) throw new Error("wrangler returned no JSON");
      const value = JSON.parse(text.slice(start));
      const rows = Array.isArray(value)
        ? value.flatMap((part) => Array.isArray(part?.results) ? part.results : [])
        : Array.isArray(value?.results) ? value.results : [];
      process.stdout.write(JSON.stringify({ rows }));
    '
}
