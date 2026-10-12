#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/db.sh"
parse_command_flags "$@" || exit $?
if [[ $COMMAND_HELP == 1 ]]; then
  cat <<'USAGE'
Usage: scripts/platform/cloudflare/unpromote.sh [--dry-run|--apply|--help]

ID=<activity-id> is required in the environment. Preview is the default;
--apply deletes the selected archive entry and its production database row.
--help prints this usage without reading the database or changing files.
USAGE
  exit 0
fi
require_d1

id=${ID:?usage: ID=<activity-id>}
select_sql=$(node --experimental-strip-types scripts/unpromote.mjs --sql --id "$id")
args=(--id "$id")
if (( COMMAND_APPLY )); then args+=(--apply); fi

result=$(d1_json "$select_sql" |
  node --experimental-strip-types scripts/unpromote.mjs "${args[@]}")
printf '%s\n' "$result"
if [[ $result != *'"deleteId":'* ]]; then
  exit 0
fi

delete_sql=$(node --experimental-strip-types scripts/unpromote.mjs --sql --delete-sql --id "$id")
d1_json "$delete_sql" >/dev/null
