#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/../recovery.sh"
COMMAND_FACILITIES=(d1)

recovery_reader() {
  "${NODE[@]}" "$ROOT/scripts/platform/cloudflare/d1.mjs" "$@"
}

recovery_adapter() {
  "${NODE[@]}" "$ROOT/scripts/recovery-sql.mjs" "$@"
}
