#!/usr/bin/env bash

parse_command_flags() {
  COMMAND_APPLY=0
  COMMAND_HELP=0
  COMMAND_FILE=
  COMMAND_FACILITY=${COMMAND_FACILITIES[0]:-}
  local apply=0 dry_run=0 flag facility found
  while (($# > 0)); do
    flag=$1
    shift
    case "$flag" in
      --apply) apply=1 ;;
      --dry-run) dry_run=1 ;;
      --help) COMMAND_HELP=1 ;;
      --file)
        [[ ${COMMAND_ALLOW_FILE:-0} == 1 ]] || { echo "unknown option: $flag" >&2; return 2; }
        if (($# == 0)) || [[ -z $1 || $1 == --* ]]; then
          echo "--file needs a value" >&2
          return 2
        fi
        COMMAND_FILE=$1
        shift
        ;;
      --facility)
        [[ -n $COMMAND_FACILITY ]] || { echo "unknown option: $flag" >&2; return 2; }
        if (($# == 0)) || [[ -z $1 || $1 == --* ]]; then
          echo "--facility needs a value" >&2
          return 2
        fi
        COMMAND_FACILITY=$1
        shift
        found=0
        for facility in "${COMMAND_FACILITIES[@]}"; do
          if [[ $facility == "$COMMAND_FACILITY" ]]; then found=1; fi
        done
        (( found )) || { echo "unknown recovery facility: $COMMAND_FACILITY" >&2; return 2; }
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

read_recovery_input() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const snapshot = JSON.parse(readFileSync(0, "utf8"));
    const document = JSON.parse(readFileSync(process.argv[1], "utf8"));
    process.stdout.write(JSON.stringify({ ...snapshot, document }) + "\n");
  ' "$1"
}

write_recovery_export() {
  local directory temporary
  directory=$(dirname -- "$1")
  mkdir -p "$directory"
  temporary=$(mktemp "$directory/.blogu-recovery-export.XXXXXX")
  cat > "$temporary"
  node --input-type=module -e '
    import { renameSync, unlinkSync } from "node:fs";
    try {
      renameSync(process.argv[1], process.argv[2]);
    } catch (error) {
      unlinkSync(process.argv[1]);
      throw error;
    }
  ' "$temporary" "$1"
}
