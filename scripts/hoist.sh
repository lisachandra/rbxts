#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${OS:-}" == "Windows_NT" ]] || [[ "$(uname -s)" =~ ^(MINGW|MSYS|CYGWIN) ]]; then
  if command -v pwsh >/dev/null 2>&1; then
    exec pwsh -NoProfile -ExecutionPolicy Bypass -File "$ROOT_DIR/scripts/hoist.ps1"
  fi

  exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ROOT_DIR/scripts/hoist.ps1"
fi

exec node "$ROOT_DIR/scripts/hoist.mjs"
