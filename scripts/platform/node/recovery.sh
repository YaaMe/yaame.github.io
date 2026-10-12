#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
NODE=(node --experimental-strip-types)
DATA_DIR=${AP_DATA_DIR:-.data}

COMMAND_APPLY=0
COMMAND_HELP=0
COMMAND_FILE=

parse_recovery_flags() {
  local apply=0 dry_run=0 flag
  while (($# > 0)); do
    flag=$1
    shift
    case "$flag" in
      --apply) apply=1 ;;
      --dry-run) dry_run=1 ;;
      --help) COMMAND_HELP=1 ;;
      --file)
        (($# > 0)) || { echo "--file needs a value" >&2; return 2; }
        COMMAND_FILE=$1
        shift
        ;;
      --*) echo "unknown option: $flag" >&2; return 2 ;;
      *) echo "unexpected argument: $flag" >&2; return 2 ;;
    esac
  done
  if (( apply && dry_run )); then
    echo "--dry-run and --apply cannot be used together" >&2
    return 2
  fi
  if (( apply )); then COMMAND_APPLY=1; fi
}

run_export_records() {
  local snapshot
  if ! snapshot=$(AP_DATA_DIR="$DATA_DIR" ${NODE[@]} "$ROOT/scripts/platform/node/records.mjs" --snapshot); then
    return 1
  fi
  printf '%s\n' "$snapshot" | ${NODE[@]} "$ROOT/scripts/recovery-records.mjs" --export
}

run_import_records() {
  [[ -n $COMMAND_FILE ]] || {
    echo "import requires --file PATH" >&2
    return 2
  }
  local snapshot
  if ! snapshot=$(AP_DATA_DIR="$DATA_DIR" ${NODE[@]} "$ROOT/scripts/platform/node/records.mjs" \
    --snapshot --import --file "$COMMAND_FILE"); then
    return 1
  fi
  printf '%s\n' "$snapshot" | ${NODE[@]} "$ROOT/scripts/recovery-records.mjs" --import
}

apply_plan() {
  AP_DATA_DIR="$DATA_DIR" ${NODE[@]} "$ROOT/scripts/platform/node/records.mjs" --apply-plan
}
