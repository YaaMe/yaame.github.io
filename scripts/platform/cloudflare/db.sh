# The binding name belongs to the Cloudflare entry point, not to the
# host-free reconciliation modules.
DB_NAME="yaame-ap-interactions"

# Parse the state-changing command contract once for every Cloudflare entry
# point. The caller decides what usage text to print for --help.
parse_command_flags() {
  COMMAND_APPLY=0
  COMMAND_HELP=0
  local apply=0 dry_run=0 flag
  for flag in "$@"; do
    case "$flag" in
      --apply) apply=1 ;;
      --dry-run) dry_run=1 ;;
      --help) COMMAND_HELP=1 ;;
      *) echo "unknown option: $flag" >&2; return 2 ;;
    esac
  done
  if [[ $apply == 1 && $dry_run == 1 ]]; then
    echo "--dry-run and --apply cannot be used together" >&2
    return 2
  fi
  if [[ $COMMAND_HELP == 1 ]]; then
    return 0
  fi
  if [[ $apply == 1 ]]; then
    COMMAND_APPLY=1
  fi
}

require_d1() {
  if [[ -z ${CF_D1_ID:-} ]]; then
    echo "  需要 CF_D1_ID" >&2
    return 1
  fi
  node scripts/wrangler-config.mjs >/dev/null
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
