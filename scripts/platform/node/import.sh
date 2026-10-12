#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/recovery.sh"

parse_recovery_flags "$@" || exit $?
if (( COMMAND_HELP )); then
  cat <<'USAGE'
Usage: scripts/platform/node/import.sh [--dry-run|--apply|--help] --file PATH

The file-access credential is AP_DATA_DIR (default: .data). --file supplies a
blogu-recovery document. Preview is the default. Import refuses a non-empty
destination and never merges or overwrites it silently; --apply writes an
empty or absent destination whose parent already exists.
USAGE
  exit 0
fi

plan=$(run_import_records)

if (( COMMAND_APPLY )); then
  result=$(printf '%s\n' "$plan" | apply_plan)
else
  result=$plan
fi

printf '%s\n' "$result"
