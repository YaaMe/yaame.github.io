#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/flags.sh"

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
NODE=(node --experimental-strip-types)
COMMAND_ALLOW_FILE=1

run_export() {
  local snapshot document snapshot_status=0
  snapshot=$(recovery_reader --snapshot) || snapshot_status=$?
  (( snapshot_status == 0 || snapshot_status == 3 )) || return "$snapshot_status"
  document=$(printf '%s\n' "$snapshot" | recovery_adapter --export)
  if (( COMMAND_APPLY )) && [[ -n $COMMAND_FILE ]]; then
    printf '%s\n' "$document" | write_recovery_export "$COMMAND_FILE"
  fi
  printf '%s\n' "$document"
  return "$(( snapshot_status != 0 ))"
}

run_import() {
  [[ -n $COMMAND_FILE ]] || {
    echo "import requires --file PATH" >&2
    return 2
  }
  local snapshot plan snapshot_status=0
  snapshot=$(recovery_reader --snapshot --import) || snapshot_status=$?
  (( snapshot_status == 0 || snapshot_status == 3 )) || return "$snapshot_status"
  plan=$(printf '%s\n' "$snapshot" | read_recovery_input "$COMMAND_FILE" | recovery_adapter --import)
  if (( COMMAND_APPLY )); then
    printf '%s\n' "$plan" | recovery_reader --apply-plan
  else
    printf '%s\n' "$plan" | recovery_reader --validate-plan
  fi
  return "$(( snapshot_status != 0 ))"
}
