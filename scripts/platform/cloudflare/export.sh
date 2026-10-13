#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/recovery.sh"

parse_command_flags "$@" || exit $?
if (( COMMAND_HELP )); then
  cat <<'USAGE'
Usage: scripts/platform/cloudflare/export.sh [--facility d1] [--dry-run|--apply|--help] [--file PATH]

CF_D1_ID selects the source database. The owner supplies a Cloudflare account
API token with D1 Read (CLOUDFLARE_API_TOKEN), or a Wrangler login, and the
account ID (CLOUDFLARE_ACCOUNT_ID). Export reads remote D1 and prints a
blogu-recovery document. --apply may also write it to --file. Stop writers
throughout the move; the default is a dry-run preview.
USAGE
  exit 0
fi

run_export
