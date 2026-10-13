#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "$0")/recovery.sh"

parse_command_flags "$@" || exit $?
if (( COMMAND_HELP )); then
  cat <<'USAGE'
Usage: scripts/platform/cloudflare/import.sh [--facility d1] [--dry-run|--apply|--help] --file PATH

CF_D1_ID selects an existing database without user schema. The owner supplies
a Cloudflare account API token with D1 Write (CLOUDFLARE_API_TOKEN), or a
Wrangler login, and the account ID (CLOUDFLARE_ACCOUNT_ID). Preview validates
the whole blogu-recovery document. --apply submits one remote SQL-file import;
D1 checks constraints at that commit boundary. Stop all writers until the
restored export has been compared with the input.
USAGE
  exit 0
fi

run_import
