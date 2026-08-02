#!/usr/bin/env bash
# Wrapper for dirac that avoids Ink's raw-mode stdin requirement.
# Sandcastle pipes the prompt via stdin; this script captures it to a
# temp file and passes it as a CLI argument with stdin from /dev/null.

set -euo pipefail

PROMPT_FILE=$(mktemp)
trap 'rm -f "$PROMPT_FILE"' EXIT

cat > "$PROMPT_FILE"

# All remaining args are dirac flags (--json, -y, -m, etc.).
# Redirect stderr to stdout so error messages are captured in the log.
exec dirac "$(cat "$PROMPT_FILE")" "$@" < /dev/null 2>&1
