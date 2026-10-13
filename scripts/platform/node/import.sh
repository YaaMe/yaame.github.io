#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/recovery.sh"

parse_command_flags "$@" || exit $?
if (( COMMAND_HELP )); then
  cat <<'USAGE'
Usage: scripts/platform/node/import.sh [--facility records|sqlite] [--dry-run|--apply|--help] --file PATH

The credential is file access: records (default) uses AP_DATA_DIR (.data);
sqlite uses AP_DB_URL (AP_DATA_DIR/interactions.sqlite by default). --file
supplies a blogu-recovery document. Preview is the default. Import refuses a
non-empty destination: any directory entry for records, any user schema for
sqlite. --apply writes an empty or absent destination whose parent exists.
USAGE
  exit 0
fi

run_import
