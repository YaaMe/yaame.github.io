#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/../recovery.sh"
DATA_DIR=${AP_DATA_DIR:-.data}
COMMAND_FACILITIES=(records sqlite)

recovery_reader() {
  AP_DATA_DIR="$DATA_DIR" "${NODE[@]}" "$ROOT/scripts/platform/node/$COMMAND_FACILITY.mjs" "$@"
}

recovery_adapter() {
  local kind=$COMMAND_FACILITY
  if [[ $kind == sqlite ]]; then kind=sql; fi
  "${NODE[@]}" "$ROOT/scripts/recovery-$kind.mjs" "$@"
}
