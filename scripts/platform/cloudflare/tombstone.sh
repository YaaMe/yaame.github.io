#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/db.sh"
parse_command_flags "$@" || exit $?
if [[ $COMMAND_HELP == 1 ]]; then
  cat <<'USAGE'
Usage: scripts/platform/cloudflare/tombstone.sh [--dry-run|--apply|--help]

Optional TOMBSTONE_PR_REF supplies the open proposal ref.

Preview is the default. --apply writes the withdrawal changes; --help prints
this usage without reading the database or changing files.
USAGE
  exit 0
fi
require_d1

sql=$(node --experimental-strip-types scripts/tombstone.mjs --sql)
args=()
if (( COMMAND_APPLY )); then args+=(--apply); fi
[[ -n ${TOMBSTONE_PR_REF:-} ]] && args+=(--pr-ref "$TOMBSTONE_PR_REF")
d1_json "$sql" | node --experimental-strip-types scripts/tombstone.mjs "${args[@]+${args[@]}}"
