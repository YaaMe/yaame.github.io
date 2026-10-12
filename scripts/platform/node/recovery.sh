#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
NODE=(node --experimental-strip-types)
DATA_DIR=${AP_DATA_DIR:-.data}

COMMAND_APPLY=0
COMMAND_HELP=0
COMMAND_FILE=
COMMAND_FACILITY=records

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
      --facility)
        (($# > 0)) || { echo "--facility needs a value" >&2; return 2; }
        COMMAND_FACILITY=$1
        shift
        case "$COMMAND_FACILITY" in
          records|sqlite) ;;
          *) echo "unknown recovery facility: $COMMAND_FACILITY" >&2; return 2 ;;
        esac
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

recovery_reader() {
  AP_DATA_DIR="$DATA_DIR" "${NODE[@]}" "$ROOT/scripts/platform/node/$COMMAND_FACILITY.mjs" "$@"
}

recovery_adapter() {
  local kind=$COMMAND_FACILITY
  if [[ $kind == sqlite ]]; then kind=sql; fi
  "${NODE[@]}" "$ROOT/scripts/recovery-$kind.mjs" "$@"
}

run_export() {
  local snapshot
  if ! snapshot=$(recovery_reader --snapshot); then
    return 1
  fi
  printf '%s\n' "$snapshot" | recovery_adapter --export
}

run_import() {
  [[ -n $COMMAND_FILE ]] || {
    echo "import requires --file PATH" >&2
    return 2
  }
  local snapshot
  if ! snapshot=$(recovery_reader --snapshot --import --file "$COMMAND_FILE"); then
    return 1
  fi
  printf '%s\n' "$snapshot" | recovery_adapter --import
}

apply_plan() {
  recovery_reader --apply-plan
}
