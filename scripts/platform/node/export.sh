#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/recovery.sh"

parse_recovery_flags "$@" || exit $?
if (( COMMAND_HELP )); then
  cat <<'USAGE'
Usage: scripts/platform/node/export.sh [--dry-run|--apply|--help] [--file PATH]

The file-access credential is AP_DATA_DIR (default: .data). Export reads the
registered JSON records and prints a versioned blogu-recovery document. --apply
may also write that document to --file; the default is a dry-run preview.
USAGE
  exit 0
fi

document=$(run_export_records)
if (( COMMAND_APPLY )) && [[ -n $COMMAND_FILE ]]; then
  directory=$(dirname -- "$COMMAND_FILE")
  mkdir -p "$directory"
  temporary=$(mktemp "$directory/.blogu-recovery-export.XXXXXX")
  trap 'rm -f "$temporary"' EXIT
  printf '%s\n' "$document" > "$temporary"
  mv "$temporary" "$COMMAND_FILE"
  trap - EXIT
fi
printf '%s\n' "$document"
