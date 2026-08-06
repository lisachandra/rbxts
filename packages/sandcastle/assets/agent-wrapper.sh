#!/usr/bin/env bash
# Generic Sandcastle agent wrapper.
#
# Captures the prompt from stdin, runs the inner provider command, and after a
# clean exit verifies the completion marker. On success it prints a protocol
# line the provider uses to flush the accumulated stream output.

set -euo pipefail

USE_STDIN=0
if [[ "${1:-}" == "--stdin" ]]; then
	USE_STDIN=1
	shift
fi

if [[ "${1:-}" != "--" ]]; then
	echo "agent-wrapper.sh: expected '--' before the inner command" >&2
	exit 2
fi
shift

INNER_COMMAND="$*"

PROMPT_FILE=$(mktemp)
trap 'rm -f "$PROMPT_FILE"' EXIT
cat > "$PROMPT_FILE"

set +e
if [[ $USE_STDIN -eq 1 ]]; then
	bash -c "$INNER_COMMAND" < "$PROMPT_FILE" 2>&1
else
	bash -c "$INNER_COMMAND" 2>&1
fi
status=$?
set -e

if [[ $status -eq 0 ]]; then
	if [[ -f "${SANDCASTLE_MARKER_COMPLETED:-}" ]]; then
		printf '%s\n' '{"sandcastleMarker":"completed"}'
	else
		echo "Sandcastle error: completion marker not found at ${SANDCASTLE_MARKER_COMPLETED:-}" >&2
		status=1
	fi
fi

exit "$status"
